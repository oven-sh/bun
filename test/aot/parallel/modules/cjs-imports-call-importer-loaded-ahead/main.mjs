// file.cjs runs while the graph of this module is loaded, and calls import() on a second file. Where Bun transpiles on one thread the loader has the text at once: the second file runs
// a fixed number of jobs later, ahead of this module. As Bun comes: file-an-imported-cjs-imports-by-call-runs-behind-entry.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./file.cjs";
console.log("main runs");
