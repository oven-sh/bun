import * as library from "node:util/types";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.isDate(new Date()), library.isRegExp(1));
