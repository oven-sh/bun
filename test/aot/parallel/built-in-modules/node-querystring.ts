import * as library from "node:querystring";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.stringify({ a: [1, 2], b: "c d" }), library.parse("a=1&a=2").a);
