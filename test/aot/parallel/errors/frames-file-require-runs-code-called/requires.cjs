exports.written = function written() {
  const first = require("./common-6.cjs");
  const second = require("./module-6.mjs");
  return [first, second];
};
exports.throughModule = function throughModule() {
  const first = module.require("./common-7.cjs");
  const second = module.require("./module-7.mjs");
  return [first, second];
};
exports.inTailPosition = function inTailPosition() {
  "use strict";
  return require("./imports.mjs");
};
require("./common-8.cjs");
require("./module-8.mjs");
