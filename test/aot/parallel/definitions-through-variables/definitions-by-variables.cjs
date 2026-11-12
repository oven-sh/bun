// Object.defineProperty in a variable, as Babel's regenerator holds it, with written descriptors.
var log = [];
function attempt(f) { try { log.push(String(f())); } catch (e) { log.push(e.name + ": " + e.message); } }
function show(o) { return JSON.stringify(Reflect.ownKeys(o).map(k => [String(k), Object.getOwnPropertyDescriptor(o, k)])); }
function make(replaced) {
  var i = Object.defineProperty;
  try { i({}, "", {}); } catch (e) { i = 0; }
  if (replaced) i = replaced;
  return function (e, r, n, t) { if (r) return i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n; };
}
var define = make(), none = make(function (o, k, d) { log.push("replaced " + String(k) + " " + Object.keys(d)); return d; });
function P() {}
P.prototype.inherited = 1;
var keys = ["a", "b", 0, 7, "length", Symbol.iterator, { toString() { log.push("key"); return "c"; } }, -1, 1.5, "__proto__"];
for (const k of keys) for (const t of [false, true, 0, "x"]) {
  attempt(() => show(define({}, k, t, t)));
  attempt(() => show(define([1, 2], k, t, t)));
  attempt(() => show(define(Object.create(P.prototype), k, 5, t)));
  attempt(() => show(none({}, k, 5, t)));
}
attempt(() => define(1, "a", 2));
attempt(() => define(null, "a", 2));
attempt(() => define(Object.freeze({}), "a", 2));
attempt(() => define(Object.freeze({ a: 2 }), "a", 2, 1));
attempt(() => define(Object.freeze({ a: 2 }), "a", 3, 1));
attempt(() => define({}, Symbol("s"), function () {}, 1) && "symbol");
attempt(() => define(function f() {}, "name", "g", 1).name);
attempt(() => show(define(new Proxy({}, { defineProperty(t, k, d) { log.push("trap " + String(k) + JSON.stringify(d)); return Reflect.defineProperty(t, k, d); } }), "p", 1, 1)));
attempt(() => define(new P(), "inherited", 2, 1).inherited);
var order = [];
var held = Object.defineProperty;
function part(x) { order.push(x); return x; }
held(part({}), part("k"), { enumerable: part(1), value: part("v"), writable: part(0), configurable: part("") });
attempt(() => order.length + order.slice(1).join());
attempt(() => show(held({}, "only", { value: function () {} })));
attempt(() => held({}, "named", { value: function () {} }).named.name + held({}, "named", { value: class {} }).named.name + held({}, "named", { value: () => 1 }).named.name);
attempt(() => show(held({ a: 1 }, "a", { writable: false })));
attempt(() => show(held({ a: 1 }, "a", { enumerable: false, configurable: false })));
var late;
attempt(() => late({}, "a", { value: 1 }));
late = Object.defineProperty;
attempt(() => show(late({}, "a", { value: 1 })));
let dead = [() => before({}, "a", { value: 1 })];
attempt(() => dead[0]());
let before = Object.defineProperty;
attempt(() => show(dead[0]()));
for (var i = 0, n = 0; i < 400; i++) { var o = Object.create(P.prototype); define(o, "_invoke", i & 7, i & 1); n += o._invoke + (Object.keys(o).length); }
log.push(n);
console.log(log.join("\n"));
