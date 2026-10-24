exports.early = 1;
const a = require("./a.cjs");
exports.sawA = a.early + ":" + a.late;
exports.late = 2;
