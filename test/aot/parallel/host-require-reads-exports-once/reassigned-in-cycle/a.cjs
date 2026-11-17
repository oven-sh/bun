globalThis.leaf = module;
const early = exports;
globalThis.load("./b.cjs");
module.exports = { name: "new" };
