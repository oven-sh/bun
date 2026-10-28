// The entry point requires between.cjs, which requires a.mjs. Neither catches what the require() throws. a.mjs imports the entry point and then throws.cjs.
console.log("main begins");
exports.early = 1;
setTimeout(() => console.log("the end"), 1);
require("./between.cjs");
exports.late = 2;
console.log("main ends");
