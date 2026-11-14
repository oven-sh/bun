import * as library from "node:v8";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.deserialize(library.serialize({ a: 1 })).a);
