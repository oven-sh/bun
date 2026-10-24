exports.early = 1;
const a = require("./a.cjs");
exports.late = 2;
exports.saw = a.saw;
exports.again = a.again;
