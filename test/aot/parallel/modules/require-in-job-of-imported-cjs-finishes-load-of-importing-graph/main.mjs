// As require-in-imported-cjs-finishes-load-of-importing-graph, but the require() that loads the last module of the graph stands in a job that file.cjs queues.
// The job runs between two steps of the loader, which has fetched last.mjs and not yet taken it in.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.mjs";
import "./back.mjs";
console.log("main runs");
