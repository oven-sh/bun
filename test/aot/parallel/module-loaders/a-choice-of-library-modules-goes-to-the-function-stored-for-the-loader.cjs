// `require(flag ? "os" : "url")` under a stored Module.prototype.require | Module._resolveFilename: the transpiler reads each name as it reads a single literal, and a library module's stays a call
// of require(): `bun run` and an executable built without --aot ask the stored function, under the name that the transpiler reads: `bun:os` is `os` to it. "bun" is no call: nobody is asked.
// `node:os` is handed as `node:os` by `bun run` and as `os` by the other: the prefix is struck out here.
const Module = require("node:module");
const asked = [];
const note = name => asked.push(name.replace(/^node:/, ""));
const requireOfLoader = Module.prototype.require;
const resolverOfLoader = Module._resolveFilename;
const one = process.argv.length > 99 ? 2 : 1;
const kind = got => (typeof got === "string" ? got : [typeof got.EOL, typeof got.parse, typeof got.join, typeof got.version].join());

Module.prototype.require = function (name) {
  note(name);
  if (name === "punycode") return "the hook's own";
  return requireOfLoader.call(this, name === "util" ? "path" : name);
};
console.log(kind(require(one === 1 ? "os" : "url")), kind(require(one === 2 ? "os" : "url")), asked.splice(0).join());
console.log(kind(require(one === 1 ? "bun:os" : "bun:url")), kind(require(one === 1 ? "node:os" : "node:url")), asked.splice(0).join());
console.log(kind(require(one === 3 ? "os" : one === 1 ? "bun:path" : "node:url")), asked.splice(0).join());
console.log(kind(require(one === 1 ? "punycode" : "url")), kind(require(one === 1 ? "util" : "url")), asked.splice(0).join());
console.log(kind(require(one === 1 ? "bun" : "os")), kind(require(one === 2 ? "bun" : "os")), asked.splice(0).join());
function load(first) {
  return require(first ? "os" : "url");
}
console.log(kind(load(true)), kind(load(false)), kind(load(true)), asked.splice(0).join());
Module.prototype.require = requireOfLoader;
console.log(kind(load(true)), asked.splice(0).join() || "nobody");

Module._resolveFilename = function (name, ...rest) {
  note(name);
  return resolverOfLoader.call(this, name, ...rest);
};
console.log(require.resolve(one === 1 ? "bun:os" : "bun:url"), require.resolve(one === 1 ? "os" : "url"), require.resolve(one === 1 ? "bun" : "os"), asked.splice(0).join());
