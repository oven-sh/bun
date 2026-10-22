const log = require("./log.cjs");
log.push("a starts");
exports.name = "a";
const b = require("./b.cjs");
log.push("a sees b: " + b.name + " " + b.done);
exports.done = true;
exports.later = () => b.name + " " + b.done;
