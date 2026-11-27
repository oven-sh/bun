// win32.resolve() asks process.env, whatever that is by then, for the working directory of another drive.
const { win32 } = require("node:path");
const made = { "=Q:": "Q:\\made\\up", get "=R:"() { console.log("getter"); return "R:\\by\\getter"; } };
process.cwd = () => "P:\\cwd";
const ask = () => ["Q:a", "R:a", "S:a", "P:a"].map(path => { try { return win32.resolve(path); } catch (error) { return error.name; } }).join(" ");
console.log(ask());
process.env = made;
console.log(ask());
