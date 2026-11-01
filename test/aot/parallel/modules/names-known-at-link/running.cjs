console.log("running.cjs starts");
exports.early = "early value";
exports.imported = require("./imports-running.cjs").imported;
exports.late = "late value";
console.log("running.cjs ends");
