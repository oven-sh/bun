console.log("file begins");
exports.early = "early";
require("./part.mjs");
exports.late = "late";
console.log("file ends");
