// A file of a ring asks for itself by import() while the ring is evaluated, once in front of its await and once behind it. Each call settles when the file where the ring was entered has run to its end.
globalThis.enter = name => import("./b.mjs").then(() => console.log("the call in " + name + " settled, and a has " + (globalThis.aHasEnded ? "ended" : "not ended")));
await import("./a.mjs");
console.log("loaded");
