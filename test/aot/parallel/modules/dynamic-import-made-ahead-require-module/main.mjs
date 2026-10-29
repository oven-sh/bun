// The entry point calls import() on a module and then requires a second one, which calls import() itself. What the entry point has asked for runs when the entry point has ended, and what the required module has asked for runs before require() returns.
console.log("main begins");
import("./imported.mjs").then(() => console.log("imported is imported"));
require("./required.mjs");
console.log("main ends");
