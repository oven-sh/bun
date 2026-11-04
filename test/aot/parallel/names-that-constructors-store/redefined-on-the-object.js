// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: the property of one object becomes an accessor, and one that is not listed.
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
const o = make(1, 2), p = make(3, 4);
Object.defineProperty(o, someKey(), { get() { log.push("read"); return "mine"; }, configurable: true });
Object.defineProperty(p, kB, { enumerable: false });
console.log(show(o), log.join());
console.log(show(p), Object.getOwnPropertySymbols(p).map(String).join(), JSON.stringify(Object.getOwnPropertyDescriptor(p, kB)), Object.getOwnPropertySymbols({ ...p }).map(String).join());
console.log(attempt(() => { o[kA] = 5; return "stored"; }));
