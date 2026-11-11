await import("./graph.mjs").then(
  graph => console.log("loaded", graph.t),
  error => console.log("rejected", error.message.replace(/".*\//, "")),
);
await import("./m1.cjs");
console.log(globalThis.answer);
await import("./m4.mjs").then(
  m4 => console.log(m4.t4),
  error => console.log("rejected", error.message.replace(/".*\//, "")),
);
