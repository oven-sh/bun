import * as library from "node:tls";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.getCiphers().length > 0, library.DEFAULT_MIN_VERSION);
