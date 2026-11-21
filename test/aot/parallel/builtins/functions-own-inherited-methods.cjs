// COUNTER: InheritedValuesDefined >= 80
// A definition that gives a built-in function, as its own property, the value that it inherits under the name. The property is defined as asked, and whoever reads the name finds the value it had.
const path = require("path");
const fs = require("fs");
const events = require("events");
const log = console.log;
const hasOwn = Object.prototype.hasOwnProperty;
const shown = (f, name) => {
  const d = Object.getOwnPropertyDescriptor(f, name);
  return d ? `${d.value === Function.prototype[name]} ${d.writable} ${d.enumerable} ${d.configurable}` : "none";
};
const attempt = (what, run) => {
  try { log(what, run()); } catch (error) { log(what, error.constructor.name); }
};
const facts = (f, name) => {
  const names = [];
  for (const key in f) names.push(key);
  return [hasOwn.call(f, name), Object.hasOwn(f, name), name in f, Object.keys(f).includes(name), Object.getOwnPropertyNames(f).includes(name), names.includes(name), shown(f, name), f[name] === Function.prototype[name]].join(" ");
};

// As packages write it: the descriptor has a value alone.
const define = Object.defineProperty;
function copy(f, name) {
  try { define.call(Object, f, name, { value: f[name] }); } catch (error) { f[name] = f[name]; }
  return f;
}
function makeSafe(f) { copy(f, "call"); copy(f, "apply"); return f; }
makeSafe(define);
makeSafe(Object.create);
const own = makeSafe(Object.prototype.hasOwnProperty);
const digits = makeSafe(Number.prototype.toString);
const slice = makeSafe(String.prototype.slice);
log(own.call({ a: 1 }, "a"), own.apply({ a: 1 }, ["b"]), digits.call(255, 16), slice.call("abcdef", 2), slice.apply("abcdef", [1, 3]));
for (const f of [define, Object.create, own, digits, slice]) log(facts(f, "call"), "/", facts(f, "apply"), "/", facts(f, "bind"));
// A second copy of the package in the same program.
makeSafe(define); makeSafe(own); makeSafe(slice);
log(facts(define, "call"), slice.call("xyz", 1));

// Each way to define, each choice of attributes.
const functions = [Math.max, Math.min, Math.abs, Math.floor, JSON.stringify, JSON.parse, Array.isArray, Number.isInteger, Object.keys, Object.freeze, Object.is, String.fromCharCode, parseInt, encodeURIComponent, Date.now, isNaN];
let next = 0;
for (let bits = 0; bits < 8; ++bits) {
  const attributes = { writable: !!(bits & 1), enumerable: !!(bits & 2), configurable: !!(bits & 4) };
  const first = functions[next++], second = functions[next++];
  attempt("defineProperties", () => Object.defineProperties(first, { call: { value: first.call, ...attributes }, bind: { value: first.bind, ...attributes } }) === first);
  attempt("Reflect", () => Reflect.defineProperty(second, "apply", { value: second.apply, ...attributes }));
  log(bits, facts(first, "call"), "/", facts(first, "bind"), "/", facts(second, "apply"));
}
log(Math.max.call(null, 1, 3, 2), Math.min.apply(null, [4, 2, 8]), Math.abs.bind(null, -5)(), JSON.stringify.call(null, { a: 1 }), parseInt.apply(null, ["12px"]));

// Functions of every making: native ones of a prototype, ones that the library has as JavaScript, ones of the host and of its modules, constructors.
const others = {
  push: Array.prototype.push, map: Array.prototype.map, concat: Array.prototype.concat, from: Array.from, reflectGet: Reflect.get, reflectApply: Reflect.apply, all: Promise.all, then: Promise.prototype.then,
  next: [][Symbol.iterator]().next, get: Map.prototype.get, test: RegExp.prototype.test, symbolFor: Symbol.for, timer: setTimeout, join: path.join, readFileSync: fs.readFileSync, on: events.prototype.on, emitter: events,
  log: console.error, nextTick: process.nextTick, call: Function.prototype.call, bind: Function.prototype.bind, text: Function.prototype.toString,
};
for (const name of Object.keys(others)) {
  const f = others[name];
  attempt(name, () => Object.defineProperty(f, "call", { value: f.call, configurable: false }) === f && facts(f, "call"));
  attempt(name, () => Reflect.defineProperty(f, "bind", { value: f.bind }) && facts(f, "bind"));
}
const constructors = { Array, Object, Map, EvalError, Date, RegExp, String, Number, DataView, WeakMap, Symbol, Proxy, URL, TextEncoder };
for (const name of Object.keys(constructors)) {
  const f = constructors[name];
  attempt(name, () => Object.defineProperty(f, "apply", { value: f.apply }) === f && facts(f, "apply"));
}
log(Array.prototype.push.call([1], 2), others.map.call([1, 2], x => x + 1).join(), others.from.call(Array, "ab").join(), path.join.call(null, "a", "b"), Reflect.apply(Math.max, null, [1, 9]), Error.apply(null, ["m"]).message, Array.apply(null, [1, 2]).length, String.apply(null, [12]));
const emitter = new events();
emitter.on.call(emitter, "a", value => log("heard", value));
emitter.emit("a", 1);

// Symbol.hasInstance.
attempt("hasInstance", () => Object.defineProperty(Set, Symbol.hasInstance, { value: Set[Symbol.hasInstance] }) === Set && [new Set() instanceof Set, new Map() instanceof Set, hasOwn.call(Set, Symbol.hasInstance)].join());

// The name is read in a loop that defines it in the middle, and in loops before and behind.
function readsAndCalls(f, n, at) {
  let sum = 0;
  for (let i = 0; i < n; ++i) {
    if (i === at) Object.defineProperty(f, "call", { value: f.call });
    sum += f.call(null, i, 3);
    sum += f.apply(null, [i, 5]);
    if (f.call !== Function.prototype.call) return "another";
  }
  return sum;
}
log(readsAndCalls(Math.pow, 4, 1), readsAndCalls(Math.hypot, 5000, 2500) > 0, readsAndCalls(Math.imul, 20000, 15000), readsAndCalls(Math.imul, 20000, -1));
function known(n) {
  let sum = 0;
  for (let i = 0; i < n; ++i) sum += Math.atan2.call(null, i, 1) + Math.atan2.apply(null, [i, 2]);
  return sum.toFixed(6);
}
const before = known(3000);
Object.defineProperty(Math.atan2, "call", { value: Math.atan2.call });
Object.defineProperty(Math.atan2, "apply", { value: Function.prototype.apply, enumerable: true });
log(before === known(3000), facts(Math.atan2, "call"), "/", facts(Math.atan2, "apply"));
log(hasOwn.call(Math.atan2, "call"), Math.atan2.hasOwnProperty("apply"), Math.atan2.hasOwnProperty("bind"), Object.getOwnPropertyNames(Math.atan2).sort().join(), JSON.stringify(Object.keys(Math.atan2)));

// What is no built-in function is what it was.
const bound = Math.sign.bind(null);
Object.defineProperty(bound, "call", { value: 1, configurable: true });
class Own { static m() { return 1; } }
Object.defineProperty(Own, "call", { value: () => 5, writable: true });
Object.defineProperty(Own.m, "apply", { value: Own.m.apply });
class Below extends Function {}
Object.defineProperty(Below, "bind", { value: Below.bind, configurable: true });
log(bound.call, Own.call(), hasOwn.call(Own.m, "apply"), facts(Below, "bind"), delete Below.bind, facts(Below, "bind"));
function plain() { return this; }
Object.defineProperty(plain, "call", { value: plain.call, configurable: true, writable: true });
plain.call = () => 7;
log(plain.call(), delete plain.call, plain.call(3) == 3);

// What plain itself refuses behind such a definition. The body of a class is strict.
class Strict {
  static assign(f) { f.call = 1; return "assigned"; }
  static remove(f) { return delete f.call; }
}
attempt("again, configurable", () => Object.defineProperty(define, "call", { value: define.call, configurable: true }));
attempt("again, enumerable", () => Reflect.defineProperty(define, "call", { enumerable: true }));
attempt("an assignment", () => Reflect.set(define, "call", 1));
attempt("a strict assignment", () => Strict.assign(define));
attempt("a deletion", () => Reflect.deleteProperty(define, "call"));
attempt("a strict deletion", () => Strict.remove(define));
attempt("frozen", () => Object.isFrozen(Object.freeze(slice)) && facts(slice, "call"));
attempt("behind that", () => Reflect.defineProperty(slice, "bind", { value: slice.bind }));
log(define.call === Function.prototype.call, slice.bind === Function.prototype.bind);
