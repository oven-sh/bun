// An earlier compiler ran the engine again where a first run showed that the load had missed or taken too much, and counted the runs: EngineRuns = 1. A build runs the engine once now.
const Module = require("node:module");
const original = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name === "asked") return this.exports.hidden();
  return original.call(this, name);
};
require("./inner.cjs");
