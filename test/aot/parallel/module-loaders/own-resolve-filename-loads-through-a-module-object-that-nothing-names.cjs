// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
const original = Module._resolveFilename;
const name = process.env.NO_SUCH_VARIABLE ?? "node:path";
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "asked") return typeof parent.require(name).sep;
  return original.call(this, request, parent, ...rest);
};
console.log(require.resolve("asked"));
