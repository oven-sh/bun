import * as library from "node:punycode";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.toASCII("\u00fc.example"));
