// An import() call that is made while a require() loads a graph is no part of that graph: what it names runs when the require() has returned. `bun run` takes the steps of the call inside the require().
// node has no require() in an ES module.
// Reference: bun build --compile
// The entry point calls import() and then requires a module that imports a CommonJS file, which requires the module back. The module calls import() too. A collection runs at every allocation.
// Env: BUN_JSC_slowPathAllocsBetweenGCs=1
import("./imported.mjs").then(() => console.log("imported is imported"));
require("./required.mjs");
console.log("main ends");
