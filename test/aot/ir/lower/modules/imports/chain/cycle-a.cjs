exports.early = 1;
const b = require("./cycle-b.cjs");
exports.late = 2;
exports.saw = b.saw;
