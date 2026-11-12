// The export helper of a bundler, called with getters that are written there: on fresh objects, on objects that have names, twice, in a loop, and on what takes no names.
const out = [];
const log = (...values) => out.push(values.join(" "));
const show = run => { try { const v = run(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (error) { return error.constructor.name; } };
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var first = {};
__export(first, { Point: () => Point, "a b": () => count, default: () => made, constructor: () => "its own", length: function named() { return 3; } });
class Point { constructor(x) { this._x = x; } get x() { return this._x; } add(o) { return new Point(this._x + o._x); } }
let count = 0, made = { m: 1 };
let sum = new Point(0);
for (let i = 0; i < 1000; i++) { sum = sum.add(new first.Point(i)); count++; }
log(sum.x, first["a b"], first.default.m, first.constructor, first.length, Object.keys(first).join());
log(Object.entries(Object.getOwnPropertyDescriptors(first)).map(([name, d]) => name + " " + d.get.name + " " + d.get.length + " " + d.enumerable + d.configurable).join());
var second = { a: 1, b: 2 };
__export(second, { b: () => "got", c: () => out.length });
log(show(() => second), show(() => __export(second, { b: () => "again" })), second.c);
for (let turn = 0; turn < 3; turn++) { var third = {}; __export(third, { turn: () => turn }); log(third.turn, Object.keys(third).join()); }
log(show(() => __export(Object.freeze({}), { a: () => 1 })), show(() => __export(undefined, { a: () => 1 })), show(() => __export({}, { a: 1 })), show(() => __export({}, { a() { return 1; } })));
var fourth = {}, odd = { a: () => 1, get b() { out.push("read"); return () => 2; }, 7: () => 7 };
__export(fourth, odd);
__export(fourth, { 3: () => 3, 1: () => 1, z: () => "z" });
log(show(() => fourth), __export(fourth, {}) === undefined);
console.log(out.join("\n"));
