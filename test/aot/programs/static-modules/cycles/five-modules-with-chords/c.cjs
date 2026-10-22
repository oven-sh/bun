const log = require("./log.cjs");
exports.step = 1;
const a = require("./a.cjs");
log.push("c sees a " + a.step);
const d = require("./d.cjs");
log.push("c sees d " + d.step);
exports.step = 2;
