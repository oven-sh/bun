// Jobs of an imported file that throws run behind the other files of a graph loaded by import.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
console.log("main begins");
await import("./graph.mjs").then(
  () => console.log("graph is imported"),
  error => console.log("graph failed:", error.message),
);
console.log("main ends");
