const Module = require("node:module");
const original = Module._resolveFilename;
const other = require.resolve("./other.cjs");
Module._resolveFilename = function (request) {
  return /^(os|sys|util)$/.test(request) ? other : original.apply(this, arguments);
};
