console.log("main begins");
await import("./graph.mjs").then(
  () => console.log("graph is imported"),
  error => console.log("graph failed:", error.message),
);
console.log("main ends");
