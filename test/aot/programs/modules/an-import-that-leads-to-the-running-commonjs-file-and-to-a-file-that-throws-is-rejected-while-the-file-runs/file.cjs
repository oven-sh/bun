const { drainMicrotasks } = require("bun:jsc");
console.log("file begins");
import("./reader.mjs").then(
  () => console.log("reader loaded"),
  error => console.log("reader rejected", error.message),
);
drainMicrotasks();
console.log("file goes on");
exports.text = "a" + process.argv.length;
