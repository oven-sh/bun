const Module = require("node:module");
const { require: load } = Module.prototype;
const { _resolveFilename: resolve } = Module;
globalThis.asked = [];
Module.prototype.require = function (id) {
  asked.push("require " + id);
  return load.apply(this, arguments);
};
Module._resolveFilename = function (request) {
  asked.push("resolve " + request);
  return request.startsWith(".") ? resolve.apply(this, arguments) : request;
};
require.cache["os"] = { exports: { platform: "entry" } };
require.cache["node:sys"] = { exports: { inspect: "entry" } };
