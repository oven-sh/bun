const { drainMicrotasks } = require("bun:jsc");
lines.push("first begins");
track("reader", import("./reader.mjs"));
drainMicrotasks();
lines.push("first goes on");
exports.text = "a" + process.argv.length;
