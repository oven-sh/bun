// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: the constructor stores under the symbol twice, and in a loop.
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
function Twice(a) { this[kA] = a; this[kA] = a + 1; for (let i = 0; i < 3; i++) this[kB] = (this[kB] ?? 0) + i; }
globalThis.holder.Twice = Twice;
const o = new globalThis.holder.Twice(1);
console.log(Reflect.ownKeys(o).map(String).join(), o[kA], o[kB]);
