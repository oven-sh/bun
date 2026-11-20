import * as library from "node:http";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.METHODS.includes("GET"), library.STATUS_CODES[200]);
