import * as library from "node:timers";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
library.clearTimeout(library.setTimeout(() => {}, 1000));
console.log("cleared");
