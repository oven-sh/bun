// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: the symbol is read, stored, asked for, deleted and defined under.
"use strict";
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
Thing.prototype.sum = function () { return String(this[kA]) + "+" + String(this[kB]); };
globalThis.holder = { Thing };
const show = () => { const o = new globalThis.holder.Thing(1, 2); return [o.sum(), Reflect.ownKeys(o).map(String).join(), String(kA), String(kB), kA === kB].join(" | "); };
console.log(show());
const o = new globalThis.holder.Thing(1, 2);
console.log(kA in o, Object.hasOwn(o, kA), o.hasOwnProperty(kB), delete o[kA], kA in o, Reflect.has(o, kB), Reflect.get(o, kB), Reflect.set(o, kA, 7), o[kA]);
Object.defineProperty(o, kB, { value: 9, enumerable: false });
console.log(o[kB], Object.getOwnPropertySymbols(o).map(String).join(), o.propertyIsEnumerable(kB), o[kA]++, o[kA], (o[kA] += 2), o?.[kB], typeof kA, kA.description, kA.toString());
const { [kA]: taken, ...rest } = o;
console.log(taken, Reflect.ownKeys(rest).map(String).join());
class Named { [kA]() { return "method"; } static [kB] = "static"; get [kB]() { return "getter"; } }
console.log(new Named()[kA](), Named[kB], new Named()[kB]);
