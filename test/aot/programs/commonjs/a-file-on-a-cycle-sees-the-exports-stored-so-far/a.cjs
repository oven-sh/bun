exports.early = 1;
const b = require("./b.cjs");
exports.late = 2;
exports.seenByB = b.seen;
