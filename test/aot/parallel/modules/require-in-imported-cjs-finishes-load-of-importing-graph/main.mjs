// file.cjs runs while the loader loads the graph of main.mjs. Its first require() leads back to the file, so the loader has the file from then on and the graph waits for last.mjs alone.
// Its second require() loads last.mjs: the graph is loaded, and first.mjs and main.mjs run, before that require() returns.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.mjs";
import "./back.mjs";
console.log("main runs");
