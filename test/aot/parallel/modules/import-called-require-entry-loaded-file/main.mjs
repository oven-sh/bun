// requires-back.cjs runs while the graph of this entry point is being loaded, and requires importer.mjs. Before that require() returns, importer.mjs and this module run. The file that importer.mjs imports on demand is no part of that graph and runs behind it. `bun run` runs it inside the require().
// Reference: bun build --compile
// Todo: `bun build --compile` runs requires-back.cjs to its end first, and the call settles in fewer jobs there. node refuses a require() in a cycle.
// Alone: the order depends on which file the executable was started as: where an import() loads main.mjs, it runs before on-demand.cjs, in `bun run` too. an-import-called-under-a-require-while-a-module-imported-on-demand-is-loaded-runs-its-file-behind-that-module prints that order
import "./importer.mjs";
console.log("main runs");
