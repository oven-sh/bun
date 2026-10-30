// The entry point requires waits.mjs, which awaits below an import of the entry point, and does not catch what the require() throws.
console.log("main begins");
exports.early = 1;
setTimeout(() => console.log("the end"), 1);
require("./waits.mjs");
exports.late = 2;
console.log("main ends");
