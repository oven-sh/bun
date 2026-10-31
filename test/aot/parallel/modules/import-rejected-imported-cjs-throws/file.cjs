const { drainMicrotasks } = require("bun:jsc");
process.on("uncaughtException", error => console.log("uncaught", error.message));
import("./file.cjs").then(
  () => console.log("itself loaded"),
  error => console.log("itself rejected", error.message),
);
import("./reader.mjs").then(
  () => console.log("reader loaded"),
  error => console.log("reader rejected", error.message),
);
drainMicrotasks();
exports.text = "a" + process.argv.length;
let after = Promise.resolve();
for (let i = 0; i < 16; i++) after = after.then(() => console.log("job after", i));
throw new Error("file throws");
