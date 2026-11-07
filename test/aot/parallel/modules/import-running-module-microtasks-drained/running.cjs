const { drainMicrotasks } = require("bun:jsc");
exports.log = ["begins"];
exports.self = import("./running.cjs").then(namespace => { exports.log.push("import settled, ended: " + namespace.default.ended); });
drainMicrotasks();
exports.log.push("after the drain");
exports.ended = true;
