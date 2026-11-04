console.log("b starts");
exports.early = 1;
const a = require("./a.mjs");
console.log("b sees " + a.fromA);
exports.late = "B".toLowerCase();
console.log("b ends");
