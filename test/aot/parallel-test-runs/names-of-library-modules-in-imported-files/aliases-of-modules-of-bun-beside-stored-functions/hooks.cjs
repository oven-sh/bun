const Module = require("node:module");
const { _resolveFilename } = Module;
Module._resolveFilename = function (request) {
  if (!request.startsWith(".")) console.log("_resolveFilename", request);
  return _resolveFilename.apply(this, arguments);
};
const { require: original } = Module.prototype;
Module.prototype.require = function (id) {
  if (!id.startsWith(".")) console.log("require", id);
  return original.apply(this, arguments);
};
