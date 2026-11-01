// requires-back.cjs runs while the graph of this entry point is being loaded, and requires importer.mjs. Before that require() returns, importer.mjs runs, then the file that it imports on demand, then this module.
// Alone: the order depends on which file the executable was started as: where an import() loads main.mjs, it runs before on-demand.cjs, in `bun run` too. an-import-called-under-a-require-while-a-module-imported-on-demand-is-loaded-runs-its-file-behind-that-module prints that order
import "./importer.mjs";
console.log("main runs");
