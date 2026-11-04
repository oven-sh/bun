// require() loads an ES module that imports asks.cjs, and asks.cjs calls import(). The call is no part of the graph that the require() loads: late.mjs runs when the require() has returned.
// While a require() loads a graph `bun run` reads every text itself, on whichever thread it transpiles otherwise, and runs late.mjs before the require() returns.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
console.log("main has", require("./root.mjs").name);
console.log("main ends");
/* Output:
asks
root
main has root over asks
main ends
job of asks
late
late is loaded: late over asks
*/
