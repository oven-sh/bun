const { drainMicrotasks } = require("bun:jsc");
const report = name => [() => console.log(name, "loaded"), error => console.log(name, "rejected", error.name)];
let before = Promise.resolve();
for (let i = 0; i < 12; i++) before = before.then(() => console.log("file: job before", i));
import("./reader.mjs").then(...report("reader"));
import("./second-reader.mjs").then(...report("second reader"));
import("./file.cjs").then(
  namespace => console.log("file itself", Object.keys(namespace).join()),
  error => console.log("file itself rejected", error.name),
);
drainMicrotasks();
console.log("file goes on");
exports.text = "a" + process.argv.length;
let after = Promise.resolve();
for (let i = 0; i < 16; i++) after = after.then(() => console.log("file: job after", i));
console.log("file ends");
