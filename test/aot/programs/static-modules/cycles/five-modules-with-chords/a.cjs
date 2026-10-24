const log = require("./log.cjs");
exports.step = 1;
const b = require("./b.cjs");
log.push("a sees b " + b.step);
exports.step = 2;
