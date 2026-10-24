const log = require("./log.cjs");
log.push("b starts");
exports.name = "b";
const c = require("./c.cjs");
log.push("b sees c: " + c.name + " " + c.done);
exports.done = true;
exports.later = () => c.name + " " + c.done;
