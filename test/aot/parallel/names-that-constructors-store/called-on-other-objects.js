// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: the constructor is called as a function on a literal, on a frozen object, on a number.
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
const plain = { sum: Thing.prototype.sum };
globalThis.holder.Thing.call(plain, 1, 2);
console.log(show(plain));
console.log(attempt(() => globalThis.holder.Thing.call(Object.freeze({}), 1, 2)));
console.log(attempt(() => globalThis.holder.Thing.call(5, 1, 2)));
console.log(attempt(() => globalThis.holder.Thing(1, 2)));
console.log(show(make(3, 4)));
