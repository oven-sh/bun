// The entry point requires a.mjs and does not catch what the require() throws. a.mjs imports throws.cjs, and one level further down b.mjs imports the entry point.
console.log("main begins");
exports.early = 1;
setTimeout(() => console.log("the end"), 1);
require("./a.mjs");
exports.late = 2;
console.log("main ends");
