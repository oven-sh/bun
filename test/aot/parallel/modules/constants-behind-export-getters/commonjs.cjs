"use strict";
const limit = 5;
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { limit: () => limit, sum: () => sum, text: () => text });
module.exports = lib_exports;
const sum = values => values.length + lib_exports.limit;
function text() {
  return "limit " + lib_exports.limit;
}
