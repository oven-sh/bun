// Two graphs fail one after the other. What they had come to runs with the first graph that is evaluated, and not again with the second.
const report = name => [() => console.log(name, "loaded", globalThis.runs), error => console.log(name, "rejected:", error.message)];
import("./first.mjs")
  .then(...report("first"))
  .then(() => import("./second.mjs"))
  .then(...report("second"))
  .then(() => import("./third.mjs"))
  .then(...report("third"))
  .then(() => import("./fourth.mjs"))
  .then(...report("fourth"));
