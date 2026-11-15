import * as library from "node:net";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.isIP("127.0.0.1"), library.isIPv6("::1"));
