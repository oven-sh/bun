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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_gauge = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.rate = 3;
});
var require_dial = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.rate = 5;
  exports.default = { rate: 50 };
});
var import_gauge = __toESM(require_gauge());
var import_dial = __toESM(require_dial());
function read(n) { let s = 0; for (let i = 0; i < n; i++) s = s + import_gauge.default.rate + import_dial.default.rate | 0; return s; }
const turns = +(process.argv[2] ?? 50);
console.log(read(turns), import_gauge.rate, import_dial.rate, Object.keys(import_gauge).join(), Object.keys(import_dial).join());
