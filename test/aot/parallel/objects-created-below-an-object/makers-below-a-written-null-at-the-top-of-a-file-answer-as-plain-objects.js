"use strict";
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const kind = (v) => (v === null ? "null" : typeof v);
const hide = (v) => [v][JSON.parse("0")];
const names = ["toString", "hasOwnProperty", "constructor", "own", "nothing", "length", "name", "prototype", "then", "size", "__proto__", "__defineGetter__", "valueOf", Symbol.iterator, Symbol.toStringTag, Symbol.toPrimitive, 0];
function ask(below) {
  const out = [];
  for (const name of names) out.push(String(name) + ":" + [attempt(() => kind(below[name])), attempt(() => name in below), attempt(() => Object.hasOwn(below, name)), attempt(() => kind(Reflect.get(below, name))), attempt(() => Reflect.has(below, name))].join(""));
  const listed = [];
  for (const key in below) listed.push(key);
  out.push("for-in:" + listed.join());
  out.push("above:" + (Object.getPrototypeOf(below) === null) + (Reflect.getPrototypeOf(below) === null) + kind(below.__proto__));
  out.push("instanceof:" + (below instanceof Object) + Object.prototype.isPrototypeOf(below));
  out.push("text:" + Object.prototype.toString.call(below) + kind(below.toString) + kind(below.valueOf) + kind(below.hasOwnProperty) + kind(below.constructor));
  out.push("to a text:" + attempt(() => String(below)) + attempt(() => `${below}`) + attempt(() => below + "") + attempt(() => +below) + attempt(() => below == "x") + attempt(() => [below].join()));
  out.push("keys:" + Object.keys(below).join() + "|" + JSON.stringify(below) + "|" + Reflect.ownKeys(below).length + "|" + JSON.stringify(Object.entries(below)) + "|" + JSON.stringify({ ...below }) + "|" + JSON.stringify(Object.assign({}, below)) + "|" + JSON.stringify(structuredClone(below)));
  return out.join(" ");
}

const asked = Object.create(null);
asked.own = 1;
console.log(ask(asked));
console.log(ask(hide(asked)));
console.log([kind(asked.toString), kind(asked.length), kind(asked.name), kind(asked.then), kind(asked.constructor), kind(asked.hasOwnProperty), kind(asked.__proto__), asked.own, attempt(() => asked.toString()), asked.own.toFixed(1), asked.toString === undefined, typeof asked.valueOf === "function"].join());

const byName = Object.create(null);
byName.own = 1;
byName.__proto__ = { inherited: 2 };
const byKey = Object.create(null);
byKey.own = 1;
byKey[hide("__proto__")] = { inherited: 3 };
console.log([kind(byName.inherited), Object.getPrototypeOf(byName) === null, Object.hasOwn(byName, "__proto__"), Object.keys(byName).join("+"), kind(byKey.inherited), Object.getPrototypeOf(byKey) === null, Object.keys(byKey).join("+")].join());

const relinked = Object.create(null);
relinked.own = 1;
console.log([kind(relinked.z), "z" in relinked].join());
Object.setPrototypeOf(relinked, { z: 5, get g() { return this.own + 1; }, set s(v) { this.own = v; } });
relinked.s = 8;
console.log([relinked.z, "z" in relinked, relinked.g, relinked.own, kind(relinked.toString), relinked instanceof Object, Object.keys(relinked).join("+")].join());
Object.setPrototypeOf(relinked, null);
console.log([kind(relinked.z), kind(relinked.toString), kind(relinked.g), relinked.own].join());

const table = Object.create(null);
table.first = 0;
for (let i = 0; i < 400; i++) table[hide("k" + (i % 97))] = i;
table[hide(3)] = "an index";
table[hide(Symbol.for("s"))] = "a symbol";
let sum = 0;
for (const key in table) sum += typeof table[key] === "number" ? table[key] : 1;
delete table.first;
delete table[hide("k5")];
console.log([sum, Object.keys(table).length, table.first, table.k5, table.k6, table[3], table[Symbol.for("s")], "first" in table, Object.keys(table).slice(0, 4).join("+")].join());

const frozen = Object.create(null);
frozen.a = 1;
Object.freeze(frozen);
const sealed = Object.create(null);
sealed.a = 1;
Object.seal(sealed);
const shut = Object.create(null);
shut.a = 1;
Object.preventExtensions(shut);
console.log([attempt(() => { frozen.a = 2; return frozen.a; }), attempt(() => { frozen.b = 2; return 0; }), Object.isFrozen(frozen), attempt(() => { sealed.a = 2; return sealed.a; }), attempt(() => { delete sealed.a; return 0; }), attempt(() => { shut.b = 1; return 0; }), attempt(() => Object.setPrototypeOf(shut, {}) && 0), attempt(() => Object.setPrototypeOf(shut, null) === shut)].join());

const described = Object.create(null);
described.own = 1;
Object.defineProperty(described, "got", { get() { return this.own * 10; }, enumerable: false, configurable: true });
Object.defineProperty(described, "own", { value: 4, writable: false });
function gets(n) { let s = 0; for (let i = 0; i < n; i++) s += described.got + described.own; return s; }
console.log([described.got, described.own, attempt(() => { described.own = 5; return 0; }), Object.keys(described).join("+"), JSON.stringify(Object.getOwnPropertyDescriptor(described, "own")), gets(50)].join());

const holder = {};
const through = (holder.table = Object.create(null));
through.a = 1;
var old = Object.create(null);
old.a = 3;
console.log([holder.table === through, holder.table.a, kind(holder.table.toString), old.a, kind(old.toString)].join());

const self = Object.create(null);
self.n = 2;
self.twice = function () { return this.n * 2; };
self.arrow = () => kind(this);
const loose = self.twice;
function calls(n) { let s = 0; for (let i = 0; i < n; i++) s += self.twice() + self.n; return s; }
console.log([self.twice(), self.arrow(), attempt(() => loose.call({ n: 5 })), attempt(() => loose()), self.twice.call(hide(self)), calls(100)].join());
self.twice = function () { return this.n * 3; };
console.log(calls(100));
delete self.twice;
console.log(attempt(() => calls(1)));

const awaited = Object.create(null);
awaited.a = 1;
const thenable = Object.create(null);
thenable.then = (resolve) => resolve("own then");
const shown = Object.create(null);
shown.a = 1;
shown.nested = Object.create(null);
(async () => [(await awaited) === awaited, await thenable].join())().then((text) => {
  console.log(text);
  console.log(shown, [shown], Bun.inspect(shown), require("node:util").inspect(shown), require("node:util").isDeepStrictEqual(shown, Object.assign(Object.create(hide(null)), { a: 1, nested: Object.create(hide(null)) })));
});
