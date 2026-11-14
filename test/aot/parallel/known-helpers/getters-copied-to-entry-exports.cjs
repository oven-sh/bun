// STATISTIC: KnownHelperCalls >= 2
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

// src/entry.ts
var entry_exports = {};
__export(entry_exports, {
  Node4: () => Node4,
  run: () => run,
  create: () => create,
  default: () => create,
  counted: () => ++reads,
  late: () => late,
  broken: () => fail("broken"),
  "with space": () => log.length
});
module.exports = __toCommonJS(entry_exports);
var log = [];
var reads = 0;
var Node4 = class {
  constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = void 0; }
  depth() { let depth = 0; for (let node = this; node; node = node.parent) depth += node.flags; return depth; }
};
function create(kind, parent) { const node = new Node4(kind, 1); node.parent = parent; return node; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = create(k & 3, node); sum += node.depth() + node.kind; } return sum; }
function fail(name) { log.push("fail " + name); throw new Error(name); }
var frames = (error) => error.stack.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("at ")).map((line) => line.replace(/\(?[^ ()]*[\\/]/, "(")).slice(0, 4).join(" < ");
log.push("end of body " + run(100) + " " + reads);
let late = "late";
setTimeout(() => {
  console.log(log.join("\n"), reads);
  console.log(Object.entries(Object.getOwnPropertyDescriptors(module.exports)).map(([name, it]) => [name, it.enumerable, it.configurable, it.writable, it.get && it.get.name, it.get && it.get.length, String(it.get), typeof it.set].join()).join("\n"));
  const all = module.exports;
  console.log(run(50), all.run(20), new all.Node4(3, 4).depth(), all.default(1, all.create(2)).depth(), all.late, all.counted, all["with space"]);
  try { all.broken; } catch (error) { console.log(error.message, frames(error)); }
  console.log(Object.keys(all).join(), Object.prototype.toString.call(all), all.__esModule, Reflect.ownKeys(all).length, Object.getOwnPropertyDescriptor(all, "run").get === Object.getOwnPropertyDescriptor(entry_exports_getters(), "run"));
  console.log(Reflect.set(all, "run", 1), delete Object.assign({}, all.Node4.prototype).x, Object.isExtensible(all), "prototype" in Object.getOwnPropertyDescriptor(all, "run").get);
}, 0);
function entry_exports_getters() { return {}; }
