import * as library from "node:module";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.isBuiltin("node:fs"), library.builtinModules.includes("path"));
