const { platform } = require("os");
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request) {
  return request.endsWith("absent.json") ? JSON.parse('"os"') : original.apply(this, arguments);
};
require.cache.os = { exports: { from: "the entry under the answer" } };
console.log(typeof platform, require(process.cwd() + "/absent.json").from, require("node:os").from);
