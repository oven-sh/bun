"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { add: () => add, count: () => count, quiet: () => quiet });
let count = 1;
function add(a, b) { return a + b; }
function quiet() { return "q"; }
exports.lib = lib_exports;
exports.run = () => [lib_exports.add(1, 2), lib_exports.count, lib_exports.quiet()].join("/");
