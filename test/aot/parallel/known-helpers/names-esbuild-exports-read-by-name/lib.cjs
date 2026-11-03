var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var lib_exports = {};
__export(lib_exports, {
  Point: () => Point,
  default: () => named,
  list: () => list,
  seven: () => seven,
  twice: () => twice
});
module.exports = __toCommonJS(lib_exports);
function twice(x) {
  return x * 2;
}
const seven = 7;
class Point {
  constructor(x) {
    this.x = x;
  }
}
var list = [1, 2, 3];
function named() {
  return "default";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Point,
  list,
  seven,
  twice
});
