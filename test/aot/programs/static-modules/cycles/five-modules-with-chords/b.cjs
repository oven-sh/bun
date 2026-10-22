const log = require("./log.cjs");
exports.step = 1;
const c = require("./c.cjs");
log.push("b sees c " + c.step);
exports.step = 2;
