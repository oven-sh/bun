const { drainMicrotasks } = require("bun:jsc");
lines.push("file begins");
track("inner", import("./root.mjs"));
drainMicrotasks();
lines.push("file goes on");
exports.text = "a" + process.argv.length;
