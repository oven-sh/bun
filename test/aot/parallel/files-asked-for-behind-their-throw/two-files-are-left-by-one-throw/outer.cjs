globalThis.log.push("outer");
const ended = require("./ended.cjs");
globalThis.retry = () => require("./outer.cjs");
const inner = require("./inner.cjs");
exports.all = ended.name + " " + inner.name;
