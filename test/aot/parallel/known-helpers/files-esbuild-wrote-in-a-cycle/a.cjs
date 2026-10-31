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
var a_exports = {};
__export(a_exports, {
  early: () => early,
  filled: () => filled,
  hoisted: () => hoisted,
  late: () => late
});
module.exports = __toCommonJS(a_exports);
var import_b = require("./b.cjs");
const early = "early of a";
function hoisted() {
  return "hoisted of a";
}
var filled = "filled of a";
console.log("a runs", import_b.fromB, (0, import_b.seeA)());
const late = "late of a";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  early,
  filled,
  hoisted,
  late
});
