// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: the constructor is declared in a function that runs twice, and one of the two prototypes has an accessor.
"use strict";
// No type tells the two symbols apart: that each key is one symbol only the flow knows.
const { kA, kB } = { kA: Symbol("a"), kB: Symbol("b") };
const log = [];
function Thing(a, b) { this.first = a; this[kA] = a; this.second = b; this[kB] = b; }
Thing.prototype.sum = function () { return String(this[kA]) + "+" + String(this[kB]); };
// Two constructors meet in one place, so nobody knows which of them a `new` enters, nor of which layout `this` is.
function Twin(a, b) { this.first = a; this[kA] = a; this.second = b; this[kB] = b; }
Object.setPrototypeOf(Twin.prototype, Thing.prototype);
globalThis.holder = { Thing, key: kA, both: [Thing, Twin], turn: 0 };
const make = (a, b) => new globalThis.holder.both[globalThis.holder.turn++ & 1](a, b);
const someKey = () => globalThis.holder.key;
const show = (o) => [o.sum(), Reflect.ownKeys(o).map(String).join(), Object.hasOwn(o, kA), kA in o, JSON.stringify(Object.getOwnPropertyDescriptor(o, kA))].join(" | ");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
function build(takes) {
  function Inner(a) { this.first = a; this[kA] = a; }
  if (takes) Object.defineProperty(Inner.prototype, someKey(), { set(v) { log.push("set " + v); }, get() { return "taken"; } });
  return Inner;
}
globalThis.holder.built = [build(false), build(true), build(false)];
for (const C of globalThis.holder.built) { const o = new C(1); console.log(Reflect.ownKeys(o).map(String).join(), String(o[kA])); }
console.log(log.join());
