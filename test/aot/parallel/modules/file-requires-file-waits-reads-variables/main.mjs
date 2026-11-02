// waiting.mjs imports asks.mjs, and asks.mjs requires waiting.mjs: it gets the names of a file whose code has not begun.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import("./waiting.mjs").then(all => console.log("loaded", all.count, all.changing, all.Kind.z));
console.log("main ends");
