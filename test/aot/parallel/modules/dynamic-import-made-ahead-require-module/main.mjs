// The entry point calls import() on a module and then requires a second one, which calls import() itself. What either has asked for runs when the entry point has ended. `bun run` runs what the required module has asked for before require() returns.
// node has no require() in an ES module.
// Reference: bun build --compile
console.log("main begins");
import("./imported.mjs").then(() => console.log("imported is imported"));
require("./required.mjs");
console.log("main ends");
