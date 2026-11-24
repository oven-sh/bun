var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

const asked = [];
let own;
var require_above = __commonJS({
  "above.js"(exports, module) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.rate = 9;
    Object.setPrototypeOf(exports, {
      get default() {
        asked.push(this === exports, this.rate);
        return { low: a => a & this.rate };
      },
    });
    own = exports;
  },
});
var require_none = __commonJS({
  "none.js"(exports, module) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.rate = 7;
  },
});
var import_above = __toESM(require_above());
var import_none = __toESM(require_none());
function sum(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + import_above.default.low(i)) | 0;
  return sum;
}
function none() {
  try {
    return import_none.default.low(1);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(asked.length, none());
console.log(sum(3), asked.splice(0).join());
own.rate = 1;
console.log(sum(5), asked.splice(0).join());
Object.defineProperty(own, "default", { value: { low: () => 100 }, configurable: true });
console.log(sum(2), asked.splice(0).join());
