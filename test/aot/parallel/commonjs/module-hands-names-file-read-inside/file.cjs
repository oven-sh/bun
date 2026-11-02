console.log("the file begins");
exports.early = { first: 1 };
require("./module.mjs");
exports.late = { second: 2 };
console.log("the file ends");
