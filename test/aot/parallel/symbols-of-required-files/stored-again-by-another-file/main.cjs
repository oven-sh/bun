// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: another file stores under the name in front of the one that takes it.
"use strict";
require("./meddles.cjs");
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
Thing.prototype.sum = function () { return String(this[kA]) + "+" + String(this[kB]); };
globalThis.holder = { Thing };
const show = () => { const o = new globalThis.holder.Thing(1, 2); return [o.sum(), Reflect.ownKeys(o).map(String).join(), String(kA), String(kB), kA === kB].join(" | "); };
console.log(show());
