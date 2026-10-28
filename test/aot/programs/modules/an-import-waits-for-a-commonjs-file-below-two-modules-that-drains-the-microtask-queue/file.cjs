const { drainMicrotasks } = require("bun:jsc");
import("./reader.mjs").then(
  () => console.log("reader loaded"),
  error => console.log("reader rejected", error.name),
);
drainMicrotasks();
console.log("file goes on");
exports.text = "a" + process.argv.length;
let after = Promise.resolve();
for (let i = 0; i < 16; i++) after = after.then(() => console.log("job after", i));
console.log("file ends");
