"use strict";
exports.direct = function direct() {
  return require("./throws-5.cjs");
};
exports.member = function member() {
  return require("./throws-6.cjs").value;
};
exports.viaModule = function viaModule() {
  return module.require("./throws-7.cjs");
};
