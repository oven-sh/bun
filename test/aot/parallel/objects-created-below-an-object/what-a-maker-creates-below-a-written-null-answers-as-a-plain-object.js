"use strict";
const holder = (globalThis.holder = {});
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
const kind = (v) => (v === null ? "null" : typeof v);
const hide = (v) => [v][JSON.parse("0")];
function ask(names) {
  const below = Object.create(null);
  below.own = 1;
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
function written() {
  const below = Object.create(null);
  below.own = 1;
  return [kind(below.toString), kind(below.url), kind(below.length), kind(below.name), kind(below.then), kind(below.size), kind(below.constructor), kind(below.hasOwnProperty), kind(below.__proto__), below.own, attempt(() => below.toString()), attempt(() => below.own.toFixed(1))].join();
}
function underscoreProto() {
  const below = Object.create(null);
  below.own = 1;
  below.__proto__ = { inherited: 2 };
  const byKey = Object.create(null);
  byKey.own = 1;
  byKey[hide("__proto__")] = { inherited: 3 };
  return [kind(below.inherited), Object.getPrototypeOf(below) === null, Object.hasOwn(below, "__proto__"), Object.keys(below).join("+"), kind(byKey.inherited), Object.getPrototypeOf(byKey) === null, Object.keys(byKey).join("+")].join();
}
function relinked() {
  const below = Object.create(null);
  below.own = 1;
  const before = [kind(below.z), "z" in below];
  Object.setPrototypeOf(below, { z: 5, get g() { return this.own + 1; } });
  const after = [below.z, "z" in below, below.g, kind(below.toString), below instanceof Object];
  Object.setPrototypeOf(below, null);
  return [...before, ...after, kind(below.z), kind(below.toString)].join();
}
function filledUnderKeysOfTheRun(count) {
  const table = Object.create(null);
  table.first = 0;
  for (let i = 0; i < count; i++) table[hide("k" + (i % 97))] = i;
  table[hide(3)] = "an index"; table[hide(Symbol.for("s"))] = "a symbol";
  let sum = 0;
  for (const key in table) sum += typeof table[key] === "number" ? table[key] : 1;
  delete table.first; delete table[hide("k5")];
  return [sum, Object.keys(table).length, table.first, table.k5, table.k6, table[3], table[Symbol.for("s")], "first" in table, Object.keys(table).slice(0, 4).join("+")].join();
}
function closed() {
  const frozen = Object.create(null); frozen.a = 1; Object.freeze(frozen);
  const sealed = Object.create(null); sealed.a = 1; Object.seal(sealed);
  const shut = Object.create(null); shut.a = 1; Object.preventExtensions(shut);
  return [attempt(() => { frozen.a = 2; return frozen.a; }), attempt(() => { frozen.b = 2; return 0; }), Object.isFrozen(frozen), attempt(() => { sealed.a = 2; return sealed.a; }), attempt(() => { delete sealed.a; return 0; }), attempt(() => { shut.b = 1; return 0; }), attempt(() => Object.setPrototypeOf(shut, {}) && 0), attempt(() => Object.setPrototypeOf(shut, null) === shut)].join();
}
function accessors() {
  const below = Object.create(null);
  below.own = 1;
  Object.defineProperty(below, "got", { get() { return this.own * 10; }, enumerable: false, configurable: true });
  Object.defineProperty(below, "own", { value: 4, writable: false });
  return [below.got, below.own, attempt(() => { below.own = 5; return 0; }), Object.keys(below).join("+"), JSON.stringify(Object.getOwnPropertyDescriptor(below, "own"))].join();
}
function through() {
  const first = (holder.table = Object.create(null));
  first.a = 1;
  let late; late = Object.create(null); late.a = 2;
  var old = Object.create(null); old.a = 3;
  return [holder.table === first, holder.table.a, kind(holder.table.toString), late.a, kind(late.toString), old.a, kind(old.toString)].join();
}
function make(i) { const made = Object.create(null); made.id = i; made.name = "n" + i; if (i & 1) made.odd = true; return made; }
function many() { let sum = 0; const kept = []; for (let i = 0; i < 300; i++) { const m = make(i); sum += m.id + m.name.length + (m.odd ? 1 : 0) + ("toString" in m ? 1000 : 0); if (i % 100 === 0) kept.push(m); } return sum + "|" + JSON.stringify(kept) + "|" + kept.every((m) => Object.getPrototypeOf(m) === null); }
function methods() { const self = Object.create(null); self.n = 2; self.twice = function () { return this.n * 2; }; self.arrow = () => kind(this); const loose = self.twice; return [self.twice(), self.arrow(), attempt(() => loose.call({ n: 5 })), self.twice.call(hide(self))].join(); }
Object.assign(holder, { ask, written, underscoreProto, relinked, filledUnderKeysOfTheRun, closed, accessors, through, many, methods });
const names = ["toString", "hasOwnProperty", "constructor", "own", "nothing", "length", "name", "prototype", "then", "size", "__proto__", "__defineGetter__", "valueOf", Symbol.iterator, Symbol.toStringTag, Symbol.toPrimitive, 0];
for (let turn = 0; turn < 2; turn++) {
  console.log(holder.ask(names)); console.log(holder.written()); console.log(holder.underscoreProto()); console.log(holder.relinked()); console.log(holder.filledUnderKeysOfTheRun(400));
  console.log(holder.closed()); console.log(holder.accessors()); console.log(holder.through()); console.log(holder.many()); console.log(holder.methods());
}
const shown = Object.create(null); shown.a = 1; shown.nested = Object.create(null);
console.log(shown, [shown], Bun.inspect(shown), require("node:util").inspect(shown), require("node:util").isDeepStrictEqual(shown, Object.assign(Object.create(hide(null)), { a: 1, nested: Object.create(hide(null)) })));
