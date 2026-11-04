console.log("b starts");
const a = require("./a.mjs");
console.log("b sees " + a.fromA);
exports.fromB = "B".toLowerCase();
console.log("b ends");
