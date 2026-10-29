// Object.defineProperty with a descriptor that is written out, on a first argument that may be anything: objects of every kind, and what is no object.
let listsFrames = true;
function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    const frames = listsFrames ? String(error.stack).split("\n").slice(1, 3).map(line => line.replace(/\(.*[\\/]/, "(").replace(/@.*[\\/]/, "@")) : [];
    console.log(label, error.constructor.name, error.message, frames.join(" | "));
  }
}
function describe(target, key) {
  const found = Object.getOwnPropertyDescriptor(target, key);
  if (!found) return "nothing";
  return Object.keys(found).map(name => name + "=" + (typeof found[name] === "function" ? "function" : String(found[name]))).join(",");
}

function defineValue(target, key, value) { Object.defineProperty(target, key, { value }); }
function defineOpen(target, key, value) { Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true }); }
function defineHidden(target, key, value) { Object.defineProperty(target, key, { value, enumerable: false, configurable: true, writable: false }); }
function defineGetter(target, key, get) { Object.defineProperty(target, key, { get, enumerable: true, configurable: true }); }
function definePair(target, key, get, set) { Object.defineProperty(target, key, { get, set }); }
function defineNothing(target, key) { Object.defineProperty(target, key, {}); }
function defineAndHandOn(target, key, value) { return Object.defineProperty(target, key, { value, enumerable: true }); }
const ways = { defineValue, defineOpen, defineHidden, defineNothing };

class Point { constructor() { this.x = 1; } get twice() { return this.x * 2; } }
const mark = Symbol("mark");
const seen = [];
const makers = {
  literal: () => ({ a: 1 }),
  empty: () => ({}),
  withoutPrototype: () => Object.create(null),
  instance: () => new Point(),
  classObject: () => class Other {},
  plainFunction: () => function named() {},
  arrow: () => () => 1,
  list: () => [1, 2, 3],
  bytes: () => new Uint8Array(2),
  map: () => new Map(),
  date: () => new Date(0),
  pattern: () => /a/g,
  failure: () => new Error("text"),
  argumentsObject: () => (function () { return arguments; })(1, 2),
  boxedText: () => new String("ab"),
  frozen: () => Object.freeze({ a: 1 }),
  sealed: () => Object.seal({ a: 1 }),
  closed: () => Object.preventExtensions({ a: 1 }),
  proxy: () => new Proxy({}, { defineProperty(target, key, descriptor) { seen.push(String(key) + ":" + Object.keys(descriptor).join("+")); return Reflect.defineProperty(target, key, descriptor); } }),
  refusingProxy: () => new Proxy({}, { defineProperty() { return false; } }),
  number: () => 1,
  text: () => "text",
  truth: () => true,
  symbol: () => Symbol.iterator,
  big: () => 10n,
  nothing: () => undefined,
  none: () => null,
};
const keys = ["a", "fresh", "0", "5", "length", "name", "prototype", "__proto__", "x", "twice", mark];

// Who refuses: the built-in, called by the function that is written here.
show("frames: no object", () => defineValue(undefined, "k", 1));
show("frames: a number", () => defineOpen(1, "k", 1));
show("frames: frozen", () => defineHidden(Object.freeze({}), "k", 1));
show("frames: a getter that is none", () => defineGetter({}, "k", 1));
show("frames: a proxy that refuses", () => defineNothing(makers.refusingProxy(), "k"));
listsFrames = false;

for (const kind in makers) {
  for (const way in ways) {
    for (const key of keys) {
      show(kind + " " + way + " " + String(key), () => {
        const target = makers[kind]();
        ways[way](target, key, 7);
        return describe(target, key) + " keys=" + Reflect.ownKeys(target).map(String).join("/");
      });
    }
  }
}
console.log(seen.join(" "));

for (const kind in makers) {
  show(kind + " getter", () => { const target = makers[kind](); defineGetter(target, "got", function () { return this === target ? "own" : "other"; }); return target.got + " " + describe(target, "got"); });
  show(kind + " pair", () => { const target = makers[kind](); let kept = 1; definePair(target, "both", () => kept, value => { kept = value + 1; }); target.both = 5; return target.both + " " + describe(target, "both"); });
  show(kind + " getter that is none", () => { const target = makers[kind](); defineGetter(target, "got", 5); return describe(target, "got"); });
  show(kind + " getter left out", () => { const target = makers[kind](); definePair(target, "both", undefined, undefined); return describe(target, "both"); });
  show(kind + " handed on", () => { const target = makers[kind](); return defineAndHandOn(target, "on", 1) === target; });
}

// What is there already decides.
show("value over a value that stays", () => { const target = {}; defineValue(target, "k", 1); defineValue(target, "k", 2); return target.k; });
show("the same value over a value that stays", () => { const target = {}; defineValue(target, "k", 1); defineValue(target, "k", 1); return target.k; });
show("NaN over NaN", () => { const target = {}; defineValue(target, "k", NaN); defineValue(target, "k", NaN); return target.k; });
show("-0 over 0", () => { const target = {}; defineValue(target, "k", 0); defineValue(target, "k", -0); return target.k; });
show("getter over a value", () => { const target = { k: 1 }; defineGetter(target, "k", () => 2); return target.k + " " + describe(target, "k"); });
show("value over a getter", () => { const target = { get k() { return 1; } }; defineOpen(target, "k", 2); return target.k + " " + describe(target, "k"); });
show("hidden over open", () => { const target = { k: 1 }; defineHidden(target, "k", 2); return Object.keys(target).length + " " + describe(target, "k"); });
show("nothing over open", () => { const target = { k: 1 }; defineNothing(target, "k"); return describe(target, "k"); });
show("order of keys", () => { const target = { b: 1 }; defineOpen(target, "a", 1); defineOpen(target, "2", 1); defineOpen(target, mark, 1); defineOpen(target, "1", 1); defineOpen(target, "b", 2); return Reflect.ownKeys(target).map(String).join(); });
show("a list grows", () => { const target = [1]; defineOpen(target, "3", 4); return target.length + " " + JSON.stringify(target); });
show("a list is cut", () => { const target = [1, 2, 3]; defineValue(target, "length", 1); return JSON.stringify(target); });
show("a length that is none", () => { const target = [1, 2, 3]; defineValue(target, "length", -1); return JSON.stringify(target); });
show("bytes outside", () => { const target = new Uint8Array(2); defineOpen(target, "2", 1); return target.length; });
show("bytes inside", () => { const target = new Uint8Array(2); defineOpen(target, "1", 300); return target[1]; });
show("a field of an instance", () => { const target = new Point(); defineHidden(target, "x", 4); return target.twice + " " + Object.keys(target).length; });
show("a method of a class", () => { defineOpen(Point.prototype, "thrice", function () { return this.x * 3; }); return new Point().thrice(); });
show("below a setter", () => { const target = Object.create({ set k(value) { throw new Error("called"); } }); defineOpen(target, "k", 1); return target.k; });
show("many objects of one shape", () => { let sum = 0; for (let i = 0; i < 50; i++) { const target = { a: i }; defineOpen(target, "b", i); defineHidden(target, "c", i); sum += target.a + target.b + target.c + Object.keys(target).length; } return sum; });
