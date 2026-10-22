const log = require("./log.cjs");
exports.step = 1;
const b = require("./b.cjs");
log.push("d sees b " + b.step);
const e = require("./e.cjs");
log.push("d sees e " + e.step);
exports.step = 2;
