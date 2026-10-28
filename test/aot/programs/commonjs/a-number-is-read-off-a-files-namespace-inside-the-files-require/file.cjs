console.log("the file begins");
exports.early = 7;
require("./module.mjs");
exports.late = 8;
console.log("the file ends");
