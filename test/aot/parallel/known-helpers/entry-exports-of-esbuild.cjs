// STATISTIC: AccessesUnknown <= 40
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
var entry_exports = {};
__export(entry_exports, {
  Node4: () => Node4,
  create: () => create,
  default: () => run,
  run: () => run
});
module.exports = __toCommonJS(entry_exports);
var Node4 = class {
  constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = void 0; }
  depth() { let depth = 0; for (let node = this; node; node = node.parent) depth += node.flags; return depth; }
};
function create(kind, parent) { const node = new Node4(kind, 1); node.parent = parent; return node; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = create(k & 3, node); sum += node.depth() + node.kind; } return sum; }
console.log(run(100), run(1000));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Node4,
  create,
  run
});
