import * as library from "node:util";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.inspect({ a: [1, { b: 2 }] }), library.format("%j", { a: 1 }), library.isDeepStrictEqual([1], [1]));
