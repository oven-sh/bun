// Alone: the number of engine runs is that of the whole build
// STATISTIC: EngineRuns = 1
const Module = require("node:module");
const original = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name === "asked") return this.exports.hidden();
  return original.call(this, name);
};
require("./inner.cjs");
