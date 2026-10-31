// Flags: --aot-limit=MaxWarmCodeValues:1
// As ../classes.ts. Modules: the order in which files run, live bindings, a cycle, namespace objects, CommonJS files and data files from both sides, import() and what it caches.
import { count, increment, reset as startOver } from "./counter.mjs";
import * as counter from "./counter.mjs";
import first, { second } from "./cycle-a.mjs";
import legacy, { named } from "./legacy.cjs";
import settings from "./settings.json";
import packaged from "a-commonjs-package";
function bindings() {
  console.log("count", count, counter.count);
  increment();
  increment();
  console.log("count", count, counter.count, typeof counter.increment);
  startOver();
  console.log("count", count, Object.keys(counter).join(), Object.prototype.toString.call(counter));
  console.log(
    "a store into a namespace:",
    Reflect.set(counter, "count", 5),
    Object.isFrozen(counter),
    Reflect.has(counter, "missing"),
    counter.missing,
  );
  console.log("cycle", first(), second());
}
function otherKinds() {
  console.log("legacy", typeof legacy, legacy.named === named, named(2), legacy.later, Object.keys(legacy).join());
  legacy.later = "set by main";
  console.log("legacy", legacy.read(), settings.port, Object.keys(settings).join(), packaged.name, packaged.double(21));
}
async function loadedLater() {
  const [again, lazy, data] = await Promise.all([
    import("./counter.mjs"),
    import("./lazy.mjs"),
    import("./settings.json"),
  ]);
  console.log(
    "import()",
    again === counter,
    lazy.default,
    lazy.seen,
    data.default === settings,
    Object.keys(data).join(),
  );
  const twice = await import("./lazy.mjs");
  console.log("again", twice === lazy, twice.seen);
  try {
    await import("./throws.mjs");
  } catch (error) {
    console.log("a file that throws:", error.message);
  }
  try {
    await import("./throws.mjs");
  } catch (error) {
    console.log("and again:", error.message);
  }
}
console.log("main runs");
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
bindings();
otherKinds();
await loadedLater();
bindings();
otherKinds();
await loadedLater();
