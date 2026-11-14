import * as library from "node:timers/promises";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(await library.setTimeout(1, "late"));
