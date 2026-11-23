const Module = require("node:module");
const { require: load } = Module.prototype;
const { _resolveFilename: resolve } = Module;
Module.prototype.require = function (id) {
  if (!id.startsWith(".")) console.log("require", id);
  return load.apply(this, arguments);
};
Module._resolveFilename = function (request) {
  if (request.startsWith(".")) return resolve.apply(this, arguments);
  console.log("resolve", request);
  return request;
};
require.cache["os"] = { exports: { platform: "entry" } };
require.cache["node:sys"] = { exports: { inspect: "entry" } };
