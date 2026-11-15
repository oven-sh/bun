import * as library from "node:_http_common";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library._checkIsHttpToken("a-b"), library._checkIsHttpToken("a b"));
