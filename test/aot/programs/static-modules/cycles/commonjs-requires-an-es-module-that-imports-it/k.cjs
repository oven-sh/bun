exports.early = 1;
const e = require("./e.mjs");
exports.late = 2;
exports.seen = e.seen;
exports.readLater = e.readLater;
