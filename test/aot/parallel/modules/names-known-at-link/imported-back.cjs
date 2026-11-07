console.log("imported-back.cjs starts");
exports.early = "early value";
exports.seenByImporter = require("./imports-back.mjs").seen;
exports.late = "late value";
console.log("imported-back.cjs ends");
