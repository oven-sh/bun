// What a constructor stores on `this` under a symbol is a field of its layout, whoever constructs. ONE DEED: one constructor stores under the symbol, the prototype of another has a getter under it.
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
function Leads(to) { this.to = to; }
Object.defineProperties(Leads.prototype, { [kA]: { get() { return this.to[kA]; } } });
globalThis.holder.Leads = Leads;
const read = (o) => o[kA];
const all = [make(1, 2), new globalThis.holder.Leads(make(3, 4)), make(5, 6), { [kA]: 7 }, Object.create({ [kA]: 8 }), []];
console.log(all.map(read).map(String).join(), all.map((o) => Object.hasOwn(o, kA)).join());
