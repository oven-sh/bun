// A CommonJS file that is still running requires an ES module that imports it back. The loader copies what the file exports by then, which runs its getters.
// It has a file that it started itself, for an import or as the entry point, and copies at once. A file that a require() started is new to it: it comes to that one
// behind what the module imports in front of it.
console.log("the entry point begins");
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("the entry point: first is read");
    return "first";
  },
});
console.log("the entry point:", require("./importer-of-the-entry-point.mjs").seen);
require("./required/running.cjs");
require("./required-and-imported-first/running.cjs");
require("./imported-by-a-required-module/middle.mjs");
import("./imported-by-call/running.cjs").then(() => console.log("the end"));
