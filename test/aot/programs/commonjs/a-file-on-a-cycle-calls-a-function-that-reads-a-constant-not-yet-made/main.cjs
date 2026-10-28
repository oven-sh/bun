// A file on a cycle calls a function that reads a constant not yet made.
const a = require("./a.cjs");
console.log(a.result);
