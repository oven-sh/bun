"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var lib_exports = {};
__export(lib_exports, { add: () => add, count: () => count, Kind: () => Kind });
let count = 0;
class Kind { constructor(v) { this.v = v; } }
function add(a, b) { count++; return a + b + (this === lib_exports ? 1 : 0); }
exports.run = n => { let s = 0; for (let i = 0; i < n; i++) s += lib_exports.add(i, 1) + new lib_exports.Kind(i).v; return s + lib_exports.count; };
