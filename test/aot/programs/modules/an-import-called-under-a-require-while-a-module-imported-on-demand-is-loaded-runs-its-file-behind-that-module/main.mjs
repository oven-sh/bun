// requires-back.cjs runs while the graph of imported.mjs is being loaded, and requires importer.mjs. Before that require() returns, importer.mjs runs, then imported.mjs, then the file that importer.mjs imports on demand.
await import("./imported.mjs");
console.log("main ends");
