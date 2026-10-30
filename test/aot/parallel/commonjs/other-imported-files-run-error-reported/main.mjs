// The other imported files run before the error of an imported file is reported.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./first.cjs";
import "./module.mjs";
import "./second.cjs";
console.log("main runs");
