// Reference: bun build --compile
// require() of a text file gives the string, and a require() behind it with the type gives the module of the text.
const bare = require("./grain.txt");
const typed = require("./grain.txt", { type: "text" });
const notes = require("./notes.md");
const notesTyped = require("./notes.md", { type: "text" });
console.log(typeof bare, Object.keys(typed).join(), typed.default === bare, require("./grain.txt", { type: "text" }) === typed);
console.log(typeof notes, Object.keys(notesTyped).join(), notesTyped.default === notes, require("./notes.md") === notes);
