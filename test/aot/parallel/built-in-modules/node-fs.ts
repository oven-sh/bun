import * as library from "node:fs";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.existsSync("/no/such/file"), library.statSync("/").isDirectory());
library.unwatchFile("/no/such/file");
