// As require-in-imported-cjs-finishes-load-of-importing-graph, but the require() that loads the last module of the graph stands in a file that file.cjs requires.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.mjs";
import "./back.mjs";
console.log("main runs");
