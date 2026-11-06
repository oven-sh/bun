// A CommonJS entry point calls import() and then drainMicrotasks() of bun:jsc: modules that import the entry point run after it has finished and see everything it exports.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
const { drainMicrotasks } = require("bun:jsc");
const report = name => [() => console.log(name, "loaded"), error => console.log(name, "rejected", error.name)];
import("./named.mjs").then(...report("named"));
import("./default.mjs").then(...report("default"));
import("./namespace.mjs").then(...report("namespace"));
import("./through-a-module.mjs").then(...report("through a module"));
import("./through-a-star.mjs").then(...report("through a star"));
import("./unrelated.mjs").then(...report("unrelated"));
import("./main.cjs").then(
  namespace => console.log("itself", Object.keys(namespace).join()),
  error => console.log("itself rejected", error.name),
);
drainMicrotasks();
console.log("main goes on");
exports.text = "a" + process.argv.length;
exports.Kind = class Kind {
  static size = process.argv.length;
};
exports.call = function call() {
  return process.argv.length;
};
console.log("main ends");
