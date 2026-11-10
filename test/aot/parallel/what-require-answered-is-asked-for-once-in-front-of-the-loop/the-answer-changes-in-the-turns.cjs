"use strict";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_gauge = __commonJS((exports) => {
  exports.rate = 3;
  exports.raise = function () { exports.rate += 1; return 0; };
  exports.drop = function () { delete exports.rate; return 0; };
  exports.guard = function () { Object.defineProperty(exports, "rate", { get() { return 100; }, configurable: true }); return 0; };
});
var import_gauge = __toESM(require_gauge());
function raised(n) { let s = 0; for (let i = 0; i < n; i++) s = s + import_gauge.default.rate + import_gauge.default.raise() + import_gauge.default.rate | 0; return s; }
function changed(n, at, how) { let s = 0; for (let i = 0; i < n; i++) { if (i === at) how(); s = s + (import_gauge.default.rate ?? -7) | 0; } return s; }
const turns = +(process.argv[2] ?? 50);
console.log(raised(turns), changed(turns, turns >> 1, import_gauge.default.guard), changed(turns, turns >> 1, import_gauge.default.drop));
