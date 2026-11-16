const notes = require("./notes.txt");
console.log("required", typeof notes, Object.keys(notes).join(), notes.default.trim());
