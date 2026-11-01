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
var b_exports = {};
__export(b_exports, {
  fromB: () => fromB,
  seeA: () => seeA
});
module.exports = __toCommonJS(b_exports);
var import_a = require("./a.cjs");
const fromB = "from b";
function attempt(read) {
  try {
    return String(read());
  } catch (error) {
    return error.constructor.name;
  }
}
function seeA() {
  return [attempt(() => import_a.early), attempt(() => (0, import_a.hoisted)()), attempt(() => import_a.filled), attempt(() => import_a.late)].join(", ");
}
console.log("b runs", seeA());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fromB,
  seeA
});
