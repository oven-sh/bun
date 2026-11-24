import * as library from "node:perf_hooks";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(typeof library.performance.now(), library.createHistogram().count);
