exports.early = 1;
const other = require("./other.cjs");
exports.late = 2;
exports.seen = other.seen;
