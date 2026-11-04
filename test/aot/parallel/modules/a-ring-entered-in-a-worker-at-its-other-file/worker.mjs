const first = import("./b.mjs");
await null;
await Promise.all([first, import("./a.mjs")]);
console.log("loaded in the worker");
