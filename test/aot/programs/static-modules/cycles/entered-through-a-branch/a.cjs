exports.early = 1;
const b = require("./b.cjs");
exports.sawB = b.early + ":" + b.late;
exports.late = 2;
