const { drainMicrotasks } = require("bun:jsc");
exports.early = "early";
import("./reads-an-early-name.mjs").then(
  () => console.log("early name loaded"),
  error => console.log("early name rejected", error.name),
);
import("./reads-a-late-name.mjs").then(
  () => console.log("late name loaded"),
  error => console.log("late name rejected", error.name),
);
drainMicrotasks();
exports.text = "a" + process.argv.length;
console.log("file ends");
