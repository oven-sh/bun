// TypeScript's __createBinding and __exportStar as emitted since 4.6: everything a program can see of what they define is as under plain Bun.
// STATISTIC: KnownHelperFunctions >= 2
// STATISTIC: KnownHelperCalls >= 16
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};

// Plain Bun gives the text of a function as its transpiler printed it, an executable as it is written: the line breaks differ.
const textOf = f => String(f).replace(/\s+/g, " ");
function describe(object) {
  const lines = [];
  for (const key of Reflect.ownKeys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    const parts = Object.keys(d).map(name => `${name}=${typeof d[name] === "function" ? `function ${JSON.stringify(d[name].name)}/${d[name].length}: ${textOf(d[name])}` : String(d[name])}`);
    lines.push(`${String(key)}: ${parts.join(" ")}`);
  }
  return lines.join("\n");
}
function attempt(label, work) {
  try {
    console.log(label, work());
  } catch (error) {
    // Plain Bun quotes the source at the end of some messages, an executable does not.
    console.log(label, "threw", error.constructor.name, error.message.replace(/ \(evaluating '.*'\)$/, ""));
  }
}

const plain = { a: 1, b: "two", default: "skipped", c: undefined };
const target = { b: "mine" };
__exportStar(plain, target);
console.log(describe(target));
console.log(Object.keys(target).join(), JSON.stringify(target), target.a, target.b, target.c);
plain.a = 10;
console.log(target.a, "live");
attempt("store", () => { target.a = 5; return target.a; });
attempt("delete", () => delete target.a);
attempt("redefine", () => Object.defineProperty(target, "a", { value: 1 }));
const first = Object.getOwnPropertyDescriptor(target, "a").get;
console.log(first === Object.getOwnPropertyDescriptor(target, "a").get, first(), first.call(null), "prototype" in first, Object.getPrototypeOf(first) === Function.prototype);
console.log(target.__lookupGetter__("a") === first, target.__lookupSetter__("a"));
delete plain.a;
console.log(target.a, "a" in target);

const marked = {};
Object.defineProperty(marked, "__esModule", { value: true });
let reads = 0;
const getter = function() { reads++; return "from getter"; };
const setter = function(v) { reads += 100; };
Object.defineProperty(marked, "both", { get: getter, set: setter, enumerable: true, configurable: true });
Object.defineProperty(marked, "hidden", { get: getter, enumerable: false, configurable: false });
Object.defineProperty(marked, "fixed", { value: 7, writable: false, enumerable: true, configurable: false });
Object.defineProperty(marked, "fixedHidden", { value: 8, writable: false, enumerable: false, configurable: false });
Object.defineProperty(marked, "readOnly", { value: 9, writable: false, enumerable: true, configurable: true });
Object.defineProperty(marked, "pinned", { value: 10, writable: true, enumerable: true, configurable: false });
const reused = {};
for (const name of ["both", "hidden", "fixed", "fixedHidden", "readOnly", "pinned", "absent"]) __createBinding(reused, marked, name);
console.log(describe(reused), reads);
console.log(Object.getOwnPropertyDescriptor(reused, "both").get === getter, Object.getOwnPropertyDescriptor(reused, "both").set === setter, Object.getOwnPropertyDescriptor(reused, "hidden").get === getter);
console.log(reused.both, reused.hidden, reused.fixed, reused.absent, reads);
marked.absent = "now there";
console.log(reused.absent);
const starred = {};
__exportStar(marked, starred);
console.log(describe(starred), reads);
Object.defineProperty(starred, "__esModule", { value: true });
const starredAgain = {};
__exportStar(starred, starredAgain);
console.log(describe(starredAgain), reads);
console.log(Object.getOwnPropertyDescriptor(starredAgain, "both").get === getter, Object.getOwnPropertyDescriptor(starredAgain, "readOnly").get === Object.getOwnPropertyDescriptor(starred, "readOnly").get);
marked.pinned = 11;
console.log(starred.pinned, starredAgain.pinned, reads);

const unmarked = {};
Object.defineProperty(unmarked, "both", { get: getter, set: setter, enumerable: true, configurable: true });
const wrapped = {};
__createBinding(wrapped, unmarked, "both");
console.log(describe(wrapped), Object.getOwnPropertyDescriptor(wrapped, "both").get === getter, wrapped.both);
for (const marker of [0, "", null, NaN, 1, "yes", {}]) {
  const source = { __esModule: marker };
  Object.defineProperty(source, "x", { get: getter, enumerable: true });
  const to = {};
  __createBinding(to, source, "x");
  console.log(String(marker), Object.getOwnPropertyDescriptor(to, "x").get === getter);
}
const inheritsMarker = Object.create({ __esModule: true });
Object.defineProperty(inheritsMarker, "x", { get: getter, enumerable: true });
const fromInheriting = {};
__createBinding(fromInheriting, inheritsMarker, "x");
console.log(Object.getOwnPropertyDescriptor(fromInheriting, "x").get === getter);
let markerReads = 0;
const computesMarker = { get __esModule() { markerReads++; return true; } };
Object.defineProperty(computesMarker, "x", { get: getter, enumerable: true });
computesMarker.y = 1;
const fromComputing = {};
__createBinding(fromComputing, computesMarker, "x");
__createBinding(fromComputing, computesMarker, "y");
console.log(markerReads, Object.getOwnPropertyDescriptor(fromComputing, "x").get === getter);

const renamed = {};
__createBinding(renamed, plain, "b", "other");
__createBinding(renamed, plain, "b", undefined);
__createBinding(renamed, plain, "b", null);
__createBinding(renamed, plain, "b", 0);
__createBinding(renamed, plain, "b", 1.5);
__createBinding(renamed, plain, 0, "zero");
const symbol = Symbol("s");
plain[symbol] = "by symbol";
__createBinding(renamed, plain, symbol);
__createBinding(renamed, plain, "b", symbol.description);
console.log(describe(renamed), renamed.other, renamed[symbol], renamed[0], renamed.zero);
const keyObject = { toString() { console.log("key converted"); return "b"; } };
__createBinding(renamed, plain, keyObject, "converted");
console.log(renamed.converted);
const joined = {};
__createBinding(joined, { ab: 1, cd: 2 }, ["a", "b"].join(""));
__createBinding(joined, { ab: 1, cd: 2 }, "cd", ["e", "f"].join(""));
__createBinding(joined, { ab: 1 }, "ab", "__proto__");
__createBinding(joined, { ab: 1 }, "__proto__", "prototypeOfTheSource");
__createBinding(joined, { "": "empty" }, "");
console.log(describe(joined), joined.ab, joined.ef, joined.__proto__, Object.getPrototypeOf(joined) === Object.prototype, joined.prototypeOfTheSource === Object.prototype, joined[""]);
console.log(__createBinding({}, plain, "b"), __exportStar(plain, {}));

const parent = { inherited: "from parent" };
Object.defineProperty(parent, "unseen", { value: 1, enumerable: false });
const child = Object.create(parent);
child.own = "own";
const fromChild = {};
__exportStar(child, fromChild);
console.log(describe(fromChild), fromChild.inherited, fromChild.own);

attempt("already there", () => { const to = { a: 1 }; __createBinding(to, { a: 2 }, "a"); return describe(to); });
attempt("already fixed", () => { const to = Object.freeze({ a: 1 }); __createBinding(to, { a: 2 }, "a"); return describe(to); });
attempt("not extensible", () => { const to = Object.preventExtensions({}); __createBinding(to, { a: 2 }, "a"); return describe(to); });
attempt("sealed", () => { const to = Object.seal({}); __exportStar({ a: 2 }, to); return describe(to); });
attempt("target is a number", () => __createBinding(1, { a: 2 }, "a"));
attempt("target is undefined", () => __createBinding(undefined, { a: 2 }, "a"));
attempt("source is undefined", () => __createBinding({}, undefined, "a"));
attempt("source is null", () => __createBinding({}, null, "a"));
attempt("source is a string", () => { const to = {}; __createBinding(to, "text", "length"); __createBinding(to, "text", 1); __createBinding(to, "text", "x"); return describe(to) + to.length + to[1]; });
attempt("source is a function", () => { const to = {}; const f = function named(a, b) {}; for (const k of ["name", "length", "prototype"]) __createBinding(to, f, k); return describe(to); });
attempt("source is an array", () => { const to = {}; __exportStar(["x", "y"], to); __createBinding(to, ["x"], "length"); return describe(to); });
attempt("target is an array", () => { const to = []; __exportStar({ 0: "x", 2: "z", name: "n" }, to); return describe(to) + to.length; });
attempt("target is a function", () => { const to = function () {}; __exportStar({ a: 1, name: "n", length: 5 }, to); return describe(to); });
attempt("star over undefined", () => { const to = {}; __exportStar(undefined, to); return describe(to); });
attempt("star over a null-prototype object", () => { const to = Object.create(null); const from = Object.create(null); from.a = 1; __exportStar(from, to); return describe(to); });
attempt("star over null", () => { const to = {}; __exportStar(null, to); return describe(to); });
attempt("star over a number", () => { const to = {}; __exportStar(5, to); return describe(to); });
attempt("star over a string", () => { const to = {}; __exportStar("ab", to); return describe(to); });
attempt("star over a frozen object", () => { const to = {}; __exportStar(Object.freeze({ a: 1, b: { c: 2 } }), to); return describe(to); });
attempt("star over a sealed object", () => { const to = {}; __exportStar(Object.seal({ a: 1 }), to); return describe(to); });
attempt("star over an object onto itself", () => { const self = { a: 1 }; __exportStar(self, self); return describe(self); });
attempt("star over an enumerable marker", () => { const to = {}; __exportStar({ __esModule: true, default: 1, a: 2 }, to); return describe(to) + to.__esModule; });
attempt("star over index keys", () => { const to = {}; __exportStar({ b: 1, 2: "two", a: 3, 1: "one" }, to); return describe(to); });
attempt("star over a symbol", () => { const to = {}; __exportStar({ [symbol]: 1, a: 2 }, to); return describe(to); });
attempt("star over an own __proto__", () => { const to = {}; __exportStar(JSON.parse('{ "__proto__": { "polluted": true }, "a": 1 }'), to); return describe(to) + Object.getPrototypeOf(to).polluted + to.polluted; });
attempt("star into an accessor of the same name", () => { const to = { get a() { return "mine"; } }; __exportStar({ a: 1, b: 2 }, to); return describe(to) + to.a; });
attempt("star into an object that inherits the name", () => { const to = Object.create({ a: "inherited" }); __exportStar({ a: 1 }, to); return describe(to) + to.a; });
attempt("star into undefined", () => __exportStar({ a: 1 }, undefined));
attempt("star of nothing into undefined", () => __exportStar({}, undefined));
attempt("star into a number", () => __exportStar({ a: 1 }, 5));
attempt("star without a target", () => __exportStar({ a: 1 }));
attempt("star without arguments", () => __exportStar());
attempt("star with one more argument", () => { const to = {}; return __exportStar({ a: 1 }, to, "more") + describe(to); });
attempt("star by spread", () => { const to = {}; __exportStar(...[{ a: 1 }, to]); return describe(to); });
attempt("star by an optional call", () => { const to = {}; __exportStar?.({ a: 1 }, to); return describe(to); });
attempt("star behind a comma", () => { const to = {}; (0, __exportStar)({ a: 1 }, to); return describe(to); });
attempt("star by call", () => { const to = {}; __exportStar.call(null, { a: 1 }, to); return describe(to); });
attempt("star as a constructor", () => { const to = {}; const made = new __exportStar({ a: 1 }, to); return describe(to) + (made instanceof __exportStar); });
function starInAFunction(from) {
  const to = {};
  __exportStar(from, to);
  return describe(to);
}
console.log(starInAFunction({ a: 1 }), starInAFunction(Object.freeze({ a: 1 })), starInAFunction(undefined));

const order = [];
const ordered = {};
console.log(__exportStar((order.push("source"), { get a() { order.push("read"); return 1; } }), (order.push("target"), ordered)), order.join(), ordered.a, order.join());

const log = [];
const observed = new Proxy({ a: 1, b: 2 }, {
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push(`describe ${String(k)}`); return Reflect.getOwnPropertyDescriptor(t, k); },
  get(t, k, r) { log.push(`get ${String(k)}`); return Reflect.get(t, k, r); },
  has(t, k) { log.push(`has ${String(k)}`); return Reflect.has(t, k); },
  getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); },
});
const fromProxy = {};
__exportStar(observed, fromProxy);
console.log(log.join(), describe(fromProxy), fromProxy.a, log.join());
log.length = 0;
const observedTarget = new Proxy({}, {
  defineProperty(t, k, d) { log.push(`define ${String(k)} ${Object.keys(d)}`); return Reflect.defineProperty(t, k, d); },
  getOwnPropertyDescriptor(t, k) { log.push(`describe ${String(k)}`); return Reflect.getOwnPropertyDescriptor(t, k); },
});
__exportStar({ a: 1 }, observedTarget);
console.log(log.join(), observedTarget.a);

const growing = { a: 1, b: 2 };
const grown = {};
Object.defineProperty(growing, "a", { get() { growing.late = "added during the loop"; delete growing.b; return 1; }, enumerable: true, configurable: true });
__exportStar(growing, grown);
console.log(describe(grown));
console.log(grown.a, Object.keys(growing).join(), grown.b);

class Holder { constructor() { this.x = 1; this.y = 2; } get z() { return 3; } }
const fromInstance = {};
__exportStar(new Holder(), fromInstance);
console.log(describe(fromInstance));
const intoInstance = new Holder();
__exportStar({ x: "kept out", w: "let in" }, intoInstance);
console.log(describe(intoInstance), intoInstance.w);
const partly = new Holder();
delete partly.x;
partly.extra = "extra";
const fromPartly = {};
__exportStar(partly, fromPartly);
console.log(describe(fromPartly), fromPartly.y, fromPartly.extra);
partly.x = "back";
console.log(fromPartly.x, Object.keys(fromPartly).join());
const fromFrozenInstance = {};
__exportStar(Object.freeze(new Holder()), fromFrozenInstance);
console.log(describe(fromFrozenInstance));

exports.own = "own";
__exportStar({ own: "kept out", added: "let in" }, exports);
__createBinding(exports, plain, "b", "renamed");
console.log(describe(exports), exports === module.exports, exports.added, exports.renamed);
const fromExports = {};
__exportStar(module.exports, fromExports);
console.log(describe(fromExports), fromExports.own, fromExports.renamed);

const many = {};
for (let i = 0; i < 300; i++) many["name" + i] = i;
const manyTarget = {};
__exportStar(many, manyTarget);
console.log(Object.keys(manyTarget).length, Object.keys(manyTarget)[299], manyTarget.name299, Object.getOwnPropertyDescriptor(manyTarget, "name150").get());
