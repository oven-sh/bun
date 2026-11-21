// esbuild's __toESM adds no default to a marked copy. One above it is asked on every read, with the copy as the receiver.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

let asked = 0;
var require_counter = __commonJS({
  "counter.js"(exports, module) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.rate = 9;
    Object.setPrototypeOf(exports, {
      get default() {
        asked++;
        return { count: asked, rate: this.rate };
      },
    });
  },
});
var import_counter = __toESM(require_counter());
function read() {
  return import_counter.default;
}
console.log(asked);
console.log(read().count, read().count, read().rate, asked);
