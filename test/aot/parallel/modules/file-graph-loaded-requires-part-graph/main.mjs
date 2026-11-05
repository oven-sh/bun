// A file of a graph that is being loaded requires part of the graph and throws.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
globalThis.log = [];
const small = import("./small.mjs");
const graph = import("./root.mjs").then(
  () => log.push("graph settles"),
  error => log.push("graph is rejected: " + error.message),
);
await small;
await graph;
console.log(log.join("\n"));
