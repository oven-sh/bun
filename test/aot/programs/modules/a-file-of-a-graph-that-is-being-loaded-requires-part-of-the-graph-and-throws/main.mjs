globalThis.log = [];
const small = import("./small.mjs");
const graph = import("./root.mjs").then(
  () => log.push("graph settles"),
  error => log.push("graph is rejected: " + error.message),
);
await small;
await graph;
console.log(log.join("\n"));
