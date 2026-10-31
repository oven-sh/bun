// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "asked") return parent.exports.first();
  if (request === "asked for a module") return console.log(parent.exports.second()), "node:path";
  return original.call(this, request, parent, ...rest);
};
require("./inner.cjs");
