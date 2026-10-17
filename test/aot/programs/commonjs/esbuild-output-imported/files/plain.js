"use strict";
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
var index_exports = {};
__export(index_exports, {
  Shape: () => Shape,
  Kind: () => Kind,
  add: () => add,
  limit: () => limit,
  table: () => table,
  default: () => index_default,
  renamed: () => original
});
module.exports = __toCommonJS(index_exports);
function add(a, b) {
  return a + b;
}
var limit = 10;
var Shape = class {
  constructor(sides) {
    this.sides = sides;
  }
  describe() {
    return "a shape with " + this.sides + " sides";
  }
};
var Kind = /* @__PURE__ */ ((Kind2) => {
  Kind2[Kind2["Round"] = 0] = "Round";
  Kind2[Kind2["Square"] = 1] = "Square";
  return Kind2;
})(Kind || {});
var table = { one: 1, two: add(1, 1) };
function original() {
  return "original";
}
var index_default = function named() {
  return "default";
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Shape,
  Kind,
  add,
  limit,
  table,
  renamed
});
