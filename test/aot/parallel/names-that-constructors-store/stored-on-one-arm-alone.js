// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: the store stands on one arm of a branch.
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
function Sometimes(a) { this.first = a; if (a & 1) this[kA] = a; this.second = a; if (a & 2) this[kB] = a; }
globalThis.holder.Sometimes = Sometimes;
for (let i = 0; i < 4; i++) { const o = new globalThis.holder.Sometimes(i); console.log(Reflect.ownKeys(o).map(String).join(), kA in o, Object.hasOwn(o, kB), String(o[kA]), String(o[kB])); }
