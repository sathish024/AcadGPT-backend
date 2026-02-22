const express = require("express");
const cors = require("cors");
require("dotenv").config();
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const Groq = require("groq-sdk");
const xlsx = require("xlsx");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const app = express();
app.use(cors());
app.use(express.json());
// ===============================
// Assignment Excel Update Function
// ===============================
const markAssignmentSubmitted = (regNo) => {
  const libraryPath = path.join(__dirname, "library");
  const filePath = path.join(libraryPath, "assignment.xlsx");

  if (!fs.existsSync(filePath)) {
    return { success: false, message: "assignment.xlsx not found in library folder." };
  }

  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    let data = xlsx.utils.sheet_to_json(sheet);
    let studentFound = false;

    data = data.map(row => {
      if (row.regno?.toString().toLowerCase() === regNo.toLowerCase()) {
        row.submitted = "true";
        studentFound = true;
      }
      return row;
    });

    if (!studentFound) {
      return { success: false, message: "Register number not found." };
    }

    const newSheet = xlsx.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newSheet;
    xlsx.writeFile(workbook, filePath);

    return { success: true, message: "✅ Assignment submitted successfully!" };

  } catch (error) {
    console.error("Excel Update Error:", error);
    return { success: false, message: "Error updating Excel file." };
  }
};

const upload = multer({ dest: "uploads/" });
const Tesseract = require("tesseract.js");

let textbookLibrary = {
  "Operating Systems": "",
  "DBMS": "",
  "Computer Networks": "",
  "AI": ""
};

// Store available files information
let availableFiles = [];

function calculateSGPA(subjects) {
  let totalCredits = 0;
  let totalCreditPoints = 0;

  subjects.forEach(sub => {
    totalCredits += sub.credit;
    totalCreditPoints += sub.creditPoint;
  });

  return (totalCreditPoints / totalCredits).toFixed(2);
}

function extractSubjectsFromText(text) {
  const subjects = [];
  const numbers = text.match(/\d+\.\d+|\d+/g);
  if (!numbers) return [];

  for (let num of numbers) {
    const match = num.match(/^(\d)(\d{1,2}\.\d{2})(\d{2})$/);

    if (match) {
      const credit = parseInt(match[1]);
      const gradePoint = parseFloat(match[2]);
      const creditPoint = parseFloat(match[3]);

      if (Math.abs(credit * gradePoint - creditPoint) < 0.5) {
        subjects.push({
          credit: credit,
          creditPoint: creditPoint
        });
      }
    }
  }

  return subjects;
}

// Function to scan and update available files
const scanLibraryFiles = () => {
  const libraryPath = path.join(__dirname, "library");
  if (!fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath);
    return [];
  }
  
  availableFiles = fs.readdirSync(libraryPath)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.txt', '.jpg', '.jpeg', '.png'].includes(ext);
    })
    .map(file => ({
      name: file,
      path: path.join(libraryPath, file),
      size: fs.statSync(path.join(libraryPath, file)).size,
      extension: path.extname(file).toLowerCase()
    }));
  
  console.log("📁 Available files in library:", availableFiles.map(f => f.name).join(", "));
  return availableFiles;
};

// --- AUTO-LOAD BOOKS ON STARTUP ---
const loadBooks = async () => {
  console.log("📚 Loading textbooks from library folder...");
  
  const booksToLoad = [
    { subject: "Operating Systems", fileName: "OS.pdf" },
    { subject: "DBMS", fileName: "DBMS.pdf" }, 
    { subject: "Computer Networks", fileName: "CN.pdf" },
    { subject: "AI", fileName: "AI.pdf" }
  ];

  // Create library folder if it doesn't exist
  const libraryPath = path.join(__dirname, "library");
  if (!fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath);
    console.log("📁 Created library folder. Please add your PDF files there.");
    return;
  }

  // Scan for all available files
  scanLibraryFiles();

  // Load textbook content
  for (const book of booksToLoad) {
    const filePath = path.join(libraryPath, book.fileName);
    
    if (fs.existsSync(filePath)) {
      try {
        console.log(`Loading ${book.fileName}...`);
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        textbookLibrary[book.subject] = data.text;
        console.log(`✅ Loaded ${book.subject} (${data.text.length} characters)`);
      } catch (err) {
        console.error(`❌ Error loading ${book.fileName}:`, err.message);
      }
    } else {
      console.warn(`⚠️ Warning: ${book.fileName} not found in library folder.`);
    }
  }
  
  // Show loaded subjects
  const loadedSubjects = Object.entries(textbookLibrary)
    .filter(([_, content]) => content.length > 0)
    .map(([subject]) => subject);
  
  console.log("✅ Successfully loaded subjects:", loadedSubjects);
};

loadBooks(); // Run this immediately

let studentTempContext = ""; 

app.post("/upload", upload.single("book"), async (req, res) => {
  try {
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    // ===== PDF Handling =====
    if (fileExtension === ".pdf") {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      studentTempContext = pdfData.text;
    }

    // ===== IMAGE Handling (OCR) =====
    else if ([".png", ".jpg", ".jpeg"].includes(fileExtension)) {
      console.log("🖼️ Extracting text from image...");
      const result = await Tesseract.recognize(req.file.path, "eng");
      studentTempContext = result.data.text;
      console.log("====== OCR TEXT ======");
      console.log(studentTempContext.substring(0, 500) + "...");
      console.log("======================");
    } else {
      studentTempContext = "Unsupported file type.";
    }

    fs.unlinkSync(req.file.path);
    res.json({ message: "File processed successfully!" });

  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ message: "Error processing file." });
  }
});

// --- Helper Function to Search Excel ---
const getStudentDataFromExcel = (rollNo) => {
  const libraryPath = path.join(__dirname, "library");
  const filePath = path.join(libraryPath, "marksheet.xlsx"); 

  if (!fs.existsSync(filePath)) return null;

  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    const student = data.find(row => 
      row.RollNo?.toString().toLowerCase() === rollNo.toString().toLowerCase()
    );

    return student;
  } catch (error) {
    console.error("Error reading Excel:", error);
    return null;
  }
};

// Function to handle file requests
const handleFileRequest = (question) => {
  // Update available files before checking
  scanLibraryFiles();
  
  const questionLower = question.toLowerCase();
  
  // Check if user is asking for a file
  const fileKeywords = [
  'download',
  'download pdf',
  'download file',
  'open file',
  'send file',
  'get pdf',
  'give pdf',
  'show files',
  'list files',
  'available files'
];

  const hasFileKeyword = fileKeywords.some(keyword => questionLower.includes(keyword));
  
  if (hasFileKeyword) {
    // Check for specific file name in the question
    for (const file of availableFiles) {
      const fileNameLower = file.name.toLowerCase();
      if (questionLower.includes(fileNameLower.replace(/\.[^/.]+$/, "")) || // Without extension
          questionLower.includes(fileNameLower)) { // With extension
        return {
          type: 'specific',
          file: file,
          message: `Here is the requested file: ${file.name}`        };
      }
    }
    
    // If asking for list of files
    if (questionLower.includes('list') || 
        questionLower.includes('available') || 
        questionLower.includes('all files') ||
        questionLower.includes('what files') ||
        questionLower.includes('show me')) {
      
      if (availableFiles.length === 0) {
        return {
          type: 'list',
          message: "No files are currently available in the library folder."
        };
      }
      
      const fileList = availableFiles.map(f => `📄 ${f.name} (${(f.size / 1024).toFixed(2)} KB)`).join('\n');
      return {
          type: 'list',
          message: `Here are the files available in the library:\n\n${fileList}\n\nYou can ask me to download any of these files.`
        };

    }
  }
  
  return null;
};

app.post("/ask", async (req, res) => {
  try {
    const { question, subject } = req.body;
    const regMatch = question.match(/(?:reg|register)\s*(?:no|number)?\s*(?:is|:|=)?\s*(\w+)/i);

    if (regMatch) {
      const regNo = regMatch[1];
      const result = markAssignmentSubmitted(regNo);
      return res.json({ answer: result.message });
    }
    
    // Check if this is a file-related request
    const fileResponse = handleFileRequest(question);
    if (fileResponse) {
      if (fileResponse.type === 'specific') {
        return res.json({ 
          answer: fileResponse.message,
          fileAvailable: true,
          fileName: fileResponse.file.name,
          downloadUrl: `https://acadgpt-backend.onrender.com/download/${encodeURIComponent(fileResponse.file.name)}`
        });
      } else {
        return res.json({ answer: fileResponse.message });
      }
    }
    
    // Handle GPA/SGPA questions
    if (question.toLowerCase().includes("gpa") || question.toLowerCase().includes("sgpa")) {
      if (!studentTempContext || studentTempContext.length === 0) {
        return res.json({ answer: "Please upload your marksheet PDF first." });
      }

      const subjects = extractSubjectsFromText(studentTempContext);
      console.log("Extracted Subjects:", subjects);
      
      if (subjects.length === 0) {
        return res.json({ answer: "Could not detect subjects in uploaded PDF." });
      }

      const sgpa = calculateSGPA(subjects);
      const totalCredits = subjects.reduce((sum, s) => sum + s.credit, 0);
      const totalCreditPoints = subjects.reduce((sum, s) => sum + s.creditPoint, 0);

      return res.json({
        answer: `
Your SGPA is ${sgpa}

Calculation:
Total Credit Points = ${totalCreditPoints}
Total Credits = ${totalCredits}
SGPA = ${totalCreditPoints} / ${totalCredits} = ${sgpa}
        `
      });
    }

    // Check for Roll Number query
    const rollNoMatch = question.match(/(?:roll\s*(?:no|number)?\s*[:=]?\s*)(\w+)/i);
    
    let excelContext = "";
    if (rollNoMatch) {
      const rollNo = rollNoMatch[1];
      const studentData = getStudentDataFromExcel(rollNo);
      
      if (studentData) {
        excelContext = `CRITICAL DATA FOUND: The student with Roll No ${rollNo} has a CGPA of ${studentData.CGPA}. Name: ${studentData.Name || 'N/A'}.`;
      } else {
        excelContext = `SYSTEM NOTE: User asked for Roll No ${rollNo}, but it was not found in the marksheet.`;
      }
    }

    // Check if this is a textbook-related question
    const isTextbookQuestion = subject && textbookLibrary[subject] && textbookLibrary[subject].length > 0;
    
    // Build context for AI
    let contextForAI = `AVAILABLE FILES IN LIBRARY: ${availableFiles.map(f => f.name).join(", ")}\n\n`;
    contextForAI += excelContext + "\n\n";
    
    if (studentTempContext && studentTempContext.trim().length > 0) {
      contextForAI += `UPLOADED IMAGE CONTENT:\n${studentTempContext.substring(0, 8000)}\n\n`;
    }

    // Only add textbook content if it exists and subject is specified
    let textbookContent = "";
    if (subject && textbookLibrary[subject]) {
      textbookContent = textbookLibrary[subject];
      if (textbookContent && textbookContent.length > 0) {
        contextForAI += `TEXTBOOK CONTENT (${subject}):\n${textbookContent.substring(0, 15000)}\n\n`;
      }
    }

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `
            You are an academic assistant with access to files.

            CRITICAL INSTRUCTION - INFORMATION AVAILABILITY CHECK:
            1. If the user asks a question about a specific subject and textbook content is provided, you MUST ONLY answer if the information is explicitly present in that textbook content.
            2. If the information is NOT found in the provided textbook content, you MUST respond with: "I apologize, but the information you're looking for is not available in the uploaded textbook for ${subject}. Please try uploading a different textbook or consult your course materials."
            3. Do NOT generate answers based on general knowledge or external information when textbook content is provided.
            4. Only use your general knowledge if NO textbook content is provided AND NO uploaded image content is present.
            5. If uploaded image content is present, prioritize answering from that content.

            Important capabilities:
            1. You can see all files in the library folder: ${availableFiles.map(f => f.name).join(", ")}
            2. If a user asks for a specific file, only confirm it is available. Do NOT print any URLs. The frontend will handle the download button.
            3. If users ask "what files are available" or similar, list all files in the library
            4. Use uploaded image content if present
            5. Use textbook content if present, but ONLY if the information exists in that content
            6. Use Excel data if CRITICAL DATA FOUND is present

            REMEMBER: When textbook content is provided, you MUST verify the information exists in that content before answering. If it doesn't exist, politely inform the user it's not available in their textbook.

            Never say you cannot see files - you have access to the library folder.
            Be professional and encouraging.
          `
        },
        {
          role: "user",
          content: `CONTEXT:\n${contextForAI}\n\nQUESTION: ${question}\n\nIMPORTANT: If this is about ${subject} and the answer is not in the provided textbook content, please inform me that the information is not available in my textbook.`
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.1, // Lower temperature for more deterministic responses
    });

    let aiText = chatCompletion.choices[0]?.message?.content || "";
    
    // Additional safety check: If this is a textbook question and answer seems too generic,
    // verify if it actually came from the textbook
    if (isTextbookQuestion && !aiText.includes("not available in the uploaded textbook") && 
        !aiText.includes("not found in") && !aiText.toLowerCase().includes("apologize")) {
      
      // Check if the answer is too short or generic (might be AI's general knowledge)
      const textbookLower = textbookContent.toLowerCase();
      const questionKeywords = question.toLowerCase().split(' ')
        .filter(word => word.length > 4) // Filter out small words
        .slice(0, 5); // Take first 5 significant words
      
      let foundInTextbook = false;
      for (const keyword of questionKeywords) {
        if (textbookLower.includes(keyword)) {
          foundInTextbook = true;
          break;
        }
      }
      
      // If no keywords found in textbook, it's likely AI made up the answer
      if (!foundInTextbook && questionKeywords.length > 0) {
        aiText = `I apologize, but the information you're looking for is not available in the uploaded textbook for ${subject}. Please try uploading a different textbook or consult your course materials.`;
      }
    }
    
    aiText = aiText.replace(/https?:\/\/[^\s]+/g, "");
    res.json({ answer: aiText });
    
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ answer: "Server error. Please try again." });
  }
});

// File download endpoint
app.get("/download/:filename", (req, res) => {
  try {
    const fileName = req.params.filename;
    // Decode the filename in case it was encoded
    const decodedFileName = decodeURIComponent(fileName);
    const filePath = path.join(__dirname, "library", decodedFileName);
    
    // Security check to prevent directory traversal attacks
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(path.join(__dirname, "library"))) {
      return res.status(403).send("Access denied");
    }
    
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${decodedFileName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      fileStream.on('error', (error) => {
        console.error("File stream error:", error);
        res.status(500).send("Error downloading file");
      });
    } else {
      console.log("File not found:", filePath);
      res.status(404).send("File not found. Available files: " + 
        (availableFiles.map(f => f.name).join(", ") || "none"));
    }
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).send("Error processing download request");
  }
});

// Endpoint to list all available files
app.get("/files", (req, res) => {
  scanLibraryFiles();
  res.json({
    files: availableFiles,
    count: availableFiles.length,
    downloadBaseUrl: "http://localhost:5000/download/"
  });
});

// Books status endpoint
app.get("/books", (req, res) => {
  const status = Object.fromEntries(
    Object.entries(textbookLibrary).map(([subject, content]) => [
      subject,
      { loaded: content.length > 0, length: content.length }
    ])
  );
  res.json(status);
});

// Refresh file list endpoint
app.post("/refresh-files", (req, res) => {
  scanLibraryFiles();
  res.json({ 
    message: "File list refreshed", 
    files: availableFiles.map(f => f.name),
    count: availableFiles.length
  });
});

app.listen(5000, "0.0.0.0", () => {
  console.log("🚀 Server running on http://localhost:5000");
  console.log("📝 Test endpoints:");
  console.log("   - http://localhost:5000/books (textbook status)");
  console.log("   - http://localhost:5000/files (list all files)");
  console.log("   - http://localhost:5000/download/filename (download files)");
});