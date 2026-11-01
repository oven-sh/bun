// import() of a deep graph, then a require() that loads all of that graph but its root, then import() of a shallower one: nothing is left to load below the first root by the time its text comes,
// so it runs ahead of the second, whose levels come a turn apart.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
globalThis.ran = [];
const deep = import("./deep-1.mjs");
const below = require("./deep-2.mjs");
const shallow = import("./shallow-1.mjs");
await Promise.all([deep, shallow]);
console.log(below.name, globalThis.ran.join(" "));
