exports.early = 1;
exports.other = 2;
const second = require("./second.cjs");
exports.late = second.seen;
exports.early = 3;
