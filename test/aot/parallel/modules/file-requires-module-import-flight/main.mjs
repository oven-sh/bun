// file.cjs requires wanted.mjs while the import() of wanted.mjs is in flight, and wanted.mjs calls import() on this module.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
console.log("main begins");
import("./wanted.mjs").then(() => console.log("main then wanted"));
import("./file.cjs").then(() => console.log("main then file"));
console.log("main ends");
