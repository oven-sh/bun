// Alone: what an executable leaves out goes by all that it holds
const Module = require("node:module");
const path = require("node:path");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request !== "asked") return original.call(this, request, parent, ...rest);
  return parent.exports.hidden() + " for " + path.basename(parent.filename);
};
require("./inner.cjs");
