// As a-name-that-the-program-writes-comes-to-a-loader-by-a-way-of-its-own, for `require`, `module.require` and the loaders of node:module in a CommonJS file. A helper that swallows the error, as packages
// write it, must not answer null for a module that plain Bun has. The output is that of plain Bun.
// Alone: it reads process.mainModule, which is the main file of the executable: as one of many entry points it is not that file
const Module = require("node:module");

function show(label, ask) {
  try {
    console.log(label, typeof ask());
  } catch (error) {
    console.log(label, error.name, error.code);
  }
}

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}
function dynamicRequire(holder, name) {
  return holder.require(name);
}
function askLoader(load) {
  return load("node:vm").runInNewContext;
}
const table = { load: require, names: { first: "node:zlib" } };
const held = module;
const { require: ofModule } = module;
const bound = typeof module !== "undefined" && typeof module.require === "function" && module.require.bind(module);

show("a helper that swallows the error", () => tryRequire("node:dgram")?.createSocket);
show("the same without the prefix", () => tryRequire("readline")?.createInterface);
show("a parameter holds module and another the name", () => dynamicRequire(module, "perf_hooks").performance);
show("a parameter holds require", () => askLoader(require));
show("a property holds require", () => table.load("node:v8").getHeapStatistics);
show("a property holds the name", () => require(table.names.first).gzipSync);
show("a constant holds module", () => held.require("node:querystring").parse);
show("require is destructured of module", () => ofModule.call(module, "node:string_decoder").StringDecoder);
show("module.require is bound", () => bound("diagnostics_channel").channel);
show("Module.prototype.require", () => Module.prototype.require.call(module, "node:punycode").toASCII);
show(
  "a require made by an alias of createRequire",
  () => (make => make(__filename))(Module.createRequire)("node:async_hooks").AsyncLocalStorage,
);
show("process.mainModule", () => process.mainModule.require("node:os").cpus);
show("require.main", () => require.main.require("node:dns").lookup);
for (const name of ["node:tls", "worker_threads"]) show("a list holds " + name, () => require(name));
show("no such module", () => tryRequire("node:no-such-module"));
