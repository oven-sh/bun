console.log("the file begins");
exports.early = { first: 1 };
const required = require("./module.mjs");
exports.late = { second: 2 };
console.log("the file ends with", required.seen);
