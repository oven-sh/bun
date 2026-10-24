const log = require("./log.cjs");
exports.step = 1;
const c = require("./c.cjs");
log.push("e sees c " + c.step);
const a = require("./a.cjs");
log.push("e sees a " + a.step);
exports.step = 2;
