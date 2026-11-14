import * as library from "node:trace_events";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(typeof library.createTracing);
