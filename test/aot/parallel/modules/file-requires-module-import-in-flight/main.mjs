// Two import() calls are in flight when file.cjs runs: its own, and the one for wanted.mjs. The file requires a module that imports wanted.mjs, so wanted.mjs runs, and the promise of its import() is settled, before the require() returns.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./calls-import.mjs";
console.log("main begins");
import("./wanted.mjs").then(() => console.log("main then wanted"));
console.log("main ends");
