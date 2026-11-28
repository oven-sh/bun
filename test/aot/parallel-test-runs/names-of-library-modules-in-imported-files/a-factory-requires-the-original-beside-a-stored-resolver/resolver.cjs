const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function () {
  return original.apply(this, arguments);
};
