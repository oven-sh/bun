// A job of an imported file requires an es module that imports a module of the graph being loaded.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./a.cjs";
import "./m1.mjs";
import "./b.cjs";
console.log("main runs");
