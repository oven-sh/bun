const log = require("./log.cjs");
log.push("c starts");
exports.name = "c";
const a = require("./a.cjs");
log.push("c sees a: " + a.name + " " + a.done);
exports.done = true;
exports.later = () => a.name + " " + a.done;
