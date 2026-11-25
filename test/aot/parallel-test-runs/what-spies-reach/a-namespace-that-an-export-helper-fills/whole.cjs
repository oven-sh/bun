"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { twice: () => twice, run: () => run });
function twice(a) { return a * 2; }
function run() { return lib_exports.twice(4); }
module.exports = lib_exports;
