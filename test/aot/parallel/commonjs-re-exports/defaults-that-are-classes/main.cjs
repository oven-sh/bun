// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 4
// `import Point from "./point.cjs"` as esbuild writes it, where the file exports a class: only the default of the copy is asked for.
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var import_point = __toESM(require("./point.cjs"));
var import_node_point = __toESM(require("./node-point.cjs"), 1);
var import_marked = __toESM(require("./marked.cjs"));
var import_marked_node = __toESM(require("./marked.cjs"), 1);
var import_without = __toESM(require("./marked-without.cjs"));
var import_heir = __toESM(require("./marked-heir.cjs"));
var import_late = __toESM(require("./marked-late.cjs"));
var import_falsy = __toESM(require("./falsy.cjs"));
function sum(count) {
    let total = new import_point.default(0, 0);
    for (let i = 0; i < count; i++)
        total = total.add(new import_point.default(i, 1));
    return total.x + total.y;
}
function sumOfNode(count) {
    let total = new import_node_point.default(0, 0);
    for (let i = 0; i < count; i++)
        total = total.add(new import_node_point.default(i, 1));
    return total.x + total.y;
}
console.log(sum(10), sumOfNode(10), import_point.default === require("./point.cjs"));
console.log(import_marked.default, import_marked_node.default === require("./marked.cjs"), import_without.default, import_heir.default, import_falsy.default());
console.log(import_late.default);
setTimeout(() => console.log(import_late.default), 5);
