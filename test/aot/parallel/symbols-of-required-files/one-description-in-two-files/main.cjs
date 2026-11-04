// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: two files make symbols with one description.
"use strict";
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
Thing.prototype.sum = function () { return String(this[kA]) + "+" + String(this[kB]); };
globalThis.holder = { Thing };
const show = () => { const o = new globalThis.holder.Thing(1, 2); return [o.sum(), Reflect.ownKeys(o).map(String).join(), String(kA), String(kB), kA === kB].join(" | "); };
console.log(show());
const others = require("./others.cjs");
const o = new globalThis.holder.Thing(1, 2); o[others.kA] = 3;
console.log(Reflect.ownKeys(o).map(String).join(), o[kA], o[others.kA], kA === others.kA);
