// Alone: the number of engine runs is that of the whole build
// STATISTIC: EngineRuns = 1
const Module = require("node:module");
const unknown = globalThis[process.argv[5] ?? "structuredClone"];
const holder = unknown({ kept: 1 });
if (process.argv.length > 6) unknown(Module, Module.prototype);
holder[process.argv[6] ?? "anything"] = () => "never";
holder._resolveFilename = () => "never";
holder.require = () => "never";
console.log(Object.keys(holder).sort().join(" "), typeof Module._resolveFilename, typeof Module.prototype.require);
console.log(typeof require(["node:", "path"].join("")).join);
