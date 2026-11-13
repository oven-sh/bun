// STATISTIC: KnownHelperCalls >= 7
// Bundles in functions: the helper that defines getters is a variable of the body that calls it.
const out = [];
const show = (v) => typeof v === "function" ? "fn " + v.name + v.length : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name + (e instanceof Error)); } };
const describe = (o) => Object.entries(Object.getOwnPropertyDescriptors(o)).map(([k, d]) => k + ":" + d.enumerable + d.configurable + typeof d.get + (d.get && d.get.name) + typeof d.set).join();

// esbuild --format=iife, as it is written and in one declaration
var library = (() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var entry_exports = {};
  __export(entry_exports, { Point: () => Point, add: () => add, count: () => count, late: () => late });
  class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
  var count = 0, late;
  function add(a, b) { count++; return new Point(a.x + b.x, a.y + b.y); }
  late = { deep: { name: "late" } };
  return entry_exports;
})();
tell(() => describe(library));
tell(() => { let p = new library.Point(0, 1); for (let i = 0; i < 50; i++) p = library.add(p, new library.Point(i, 1)); return [p.sum(), library.count, library.late.deep.name]; });
tell(() => [Reflect.set(library, "add", 1), typeof library.add]);

var minified = (() => { var t=Object.defineProperty,i=(Object.getOwnPropertyDescriptor,Object.getOwnPropertyNames,Object.prototype.hasOwnProperty,(e,n)=>{for(var r in n)t(e,r,{get:n[r],enumerable:!0})}),o={};i(o,{Node:()=>N,make:()=>make,held:()=>h}),o.later=o;class N{constructor(e){this.kind=e,this.next=void 0}get name(){return"n"+this.kind}}var h=new N(7);function make(e){const t=new N(e);return t.next=h,h=t}return o })();
tell(() => describe(minified));
tell(() => { let s = ""; for (let i = 0; i < 20; i++) s += minified.make(i).next.name; return s + minified.held.name + (minified.later === minified) + (minified.held instanceof minified.Node); });

// TypeScript's own wrapper
var ts = {}; ((module) => {
  "use strict";
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var typescript_exports = {};
  __export(typescript_exports, { create: () => create, setAllocator: () => setAllocator, allocator: () => allocator });
  module.exports = typescript_exports;
  function Node4(kind) { this.kind = kind; this.flags = 0; this.parent = undefined; }
  var allocator = { getNode: () => Node4 };
  function setAllocator(a) { Object.assign(allocator, a); }
  var Object5 = class NodeObject { constructor(kind) { this.kind = kind; this.flags = 1; this.parent = undefined; } depth() { return this.parent ? 1 + this.parent.depth() : 0; } };
  setAllocator({ getNode: () => Object5 });
  var constructor;
  function create(kind, parent) { const n = new (constructor || (constructor = allocator.getNode()))(kind); n.parent = parent; return n; }
})({ get exports() { return ts; }, set exports(v) { ts = v; if (typeof module !== "undefined" && module.exports) { module.exports = v; } } });
tell(() => { let p; for (let i = 0; i < 30; i++) p = ts.create(i, p); return [p.depth(), p.flags, p.kind, p.constructor.name]; });
tell(() => { ts.allocator.getNode = () => class Other { constructor(k) { this.k = k; } }; return ts.create(3) instanceof Object; });

// each activation has its own helper, target and values
function factory(start) {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  var names = {};
  __export(names, { value: () => start, next: () => ++start });
  return names;
}
tell(() => { const a = factory(1), b = factory(10); return [a.next, a.next, b.next, a.value, b.value]; });
function* stepped(v) {
  const __defProp = Object.defineProperty;
  const __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  const names = {};
  yield 1;
  __export(names, { v: () => v });
  yield names;
}
tell(() => { const g = stepped(4); g.next(); return g.next().value.v; });

// the call stands ahead of the helper, or runs ahead of it
tell(() => {
  var names = {};
  __export(names, { a: () => 1 });
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  return names.a;
});
tell(() => {
  var names = {};
  early();
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  function early() { __export(names, { a: () => 1 }); }
  return names.a;
});
tell(() => {
  var names = {};
  const later = () => __export(names, { a: () => 2 });
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  later();
  return names.a;
});
tell(() => {
  var names = {};
  const __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  __export(names, { a: () => 3 });
  var __defProp = Object.defineProperty;
  return names.a;
});

// the helper is another function at times
tell(() => {
  var names = {}, calls = [];
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  __export(names, { a: () => 1 });
  __export = (target, all) => { calls.push(Object.keys(all)); };
  __export(names, { b: () => 2 });
  return [names.a, names.b, calls];
});
tell(() => {
  var names = {}, calls = 0;
  var __defProp = (o, k, d) => { calls++; Object.defineProperty(o, k, d); };
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  __export(names, { a: () => 1, b: () => 2 });
  return [names.a, names.b, calls];
});
tell(() => {
  var names = {};
  var __defProp = Object.defineProperty;
  if (out.length > 3) var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  __export(names, { a: () => 4 });
  return names.a;
});
tell(() => {
  var s = [];
  for (let i = 0; i < 3; i++) {
    var names = {};
    if (i) __export(names, { a: () => i });
    var __defProp = Object.defineProperty;
    var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
    s.push(names.a);
  }
  return s;
});

// targets that refuse
tell(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  const frozen = Object.freeze({ z: 1 });
  __export(frozen, { a: () => 1 });
  return frozen.a;
});
tell(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  const held = Object.defineProperty({}, "b", { value: 5 });
  try { __export(held, { a: () => 1, b: () => 2, c: () => 3 }); } catch (e) { return [e.constructor.name, held.a, held.b, held.c]; }
});
tell(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  const seen = [];
  const proxy = new Proxy({}, { defineProperty(t, k, d) { seen.push(k + Object.keys(d)); return Reflect.defineProperty(t, k, d); } });
  __export(proxy, { a: () => 1, b: function () { return this === proxy; } });
  return [seen, proxy.a, proxy.b];
});
tell(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };
  __export(null, { a: () => 1 });
});
console.log(out.join("\n"));
