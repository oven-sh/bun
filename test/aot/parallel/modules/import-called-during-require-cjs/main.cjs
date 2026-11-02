// calls-import.mjs calls import() on file.cjs while this require() loads it, so the file runs before the require() returns. The module that the file requires imports the file back and binds what it has exported by then.
// The import() and whoever imports the file later get what it has exported when its body has ended.
console.log("main begins");
require("./calls-import.mjs");
console.log("main ends");
