// An earlier compiler ran the engine again where a first run showed that the load had missed or taken too much, and counted the runs: EngineRuns = 1. A build runs the engine once now.
const Module = require("node:module");
globalThis.held = module;
exports.hidden = function () {
  return "hidden ran";
};
const key = process.argv[5] ?? ["_resolve", "Filename"].join("");
const original = Module._resolveFilename;
Module[key] = function (request, parent, ...rest) {
  if (request === "asked") return parent.exports.hidden();
  return original.call(this, request, parent, ...rest);
};
const box = { resolve: require.resolve };
console.log(box.resolve("asked"));
console.log(typeof globalThis.held.children, typeof globalThis.held.parent);
