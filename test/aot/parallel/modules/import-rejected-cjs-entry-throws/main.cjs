// A CommonJS entry point calls import(), drainMicrotasks() of bun:jsc and then throws: every import() that leads to the entry point is rejected with the error, and the error is uncaught as well.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
const { drainMicrotasks } = require("bun:jsc");
process.on("uncaughtException", error => console.log("uncaught", error.message));
import("./reader.mjs").then(
  () => console.log("reader loaded"),
  error => console.log("reader rejected", error.message),
);
import("./main.cjs").then(
  () => console.log("itself loaded"),
  error => console.log("itself rejected", error.message),
);
drainMicrotasks();
exports.text = "a" + process.argv.length;
let after = Promise.resolve();
for (let i = 0; i < 14; i++) after = after.then(() => console.log("job after", i));
throw new Error("main throws");
