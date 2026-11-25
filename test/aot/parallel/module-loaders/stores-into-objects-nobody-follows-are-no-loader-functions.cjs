// An earlier compiler ran the engine again where a first run showed that the load had missed or taken too much, and counted the runs: EngineRuns = 1. A build runs the engine once now.
const Module = require("node:module");
const unknown = globalThis[process.argv[5] ?? "structuredClone"];
const holder = unknown({ kept: 1 });
if (process.argv.length > 6) unknown(Module, Module.prototype);
holder[process.argv[6] ?? "anything"] = () => "never";
holder._resolveFilename = () => "never";
holder.require = () => "never";
console.log(Object.keys(holder).sort().join(" "), typeof Module._resolveFilename, typeof Module.prototype.require);
console.log(typeof require(["node:", "path"].join("")).join);
