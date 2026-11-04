// The second call comes from a CommonJS file that runs while the graph of the first is loaded. What it asks for comes a turn later, behind that graph.
await import("./a.mjs");
await globalThis.asked;
console.log("loaded");
