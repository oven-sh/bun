const { drainMicrotasks } = require("bun:jsc");
import("./reads-first.mjs").then(
  () => lines.push("reads-first loaded"),
  error => lines.push("reads-first rejected " + error.message),
);
drainMicrotasks();
exports.text = "a" + process.argv.length;
