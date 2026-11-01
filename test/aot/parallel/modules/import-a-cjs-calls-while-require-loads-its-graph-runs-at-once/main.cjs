// require() loads an ES module that imports asks.cjs, and asks.cjs calls import(). While a require() loads a graph Bun reads every text itself, on whichever thread it transpiles otherwise:
// late.mjs runs before the require() returns.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
console.log("main has", require("./root.mjs").name);
console.log("main ends");
