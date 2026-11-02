// createRequire is read off a copy of node:module that a spread makes.
const copy = { ...require("node:module") };
const load = copy.createRequire(__filename);
console.log(load("./a.cjs").a, load("./a.cjs") === require("./a.cjs"), typeof load("node:net").Socket);
