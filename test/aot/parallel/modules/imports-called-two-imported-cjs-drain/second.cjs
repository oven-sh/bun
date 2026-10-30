const { drainMicrotasks } = require("bun:jsc");
import("./reads-second.mjs").then(
  () => lines.push("reads-second loaded"),
  error => lines.push("reads-second rejected " + error.message),
);
drainMicrotasks();
exports.text = "b" + process.argv.length;
throw new Error("second throws");
