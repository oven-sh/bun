// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: the object is handed to JSON.stringify() with a replacer that stores into it.
"use strict";
JSON.stringify({ held: require("./symbols.cjs") }, function (key, value) { if (key === "held") value.kA = Symbol("replaced"); return value; });
const { kA, kB } = require("./symbols.cjs");
function Thing(a, b) { this.first = a; this[kA] = a; this[kB] = b; }
Thing.prototype.sum = function () { return String(this[kA]) + "+" + String(this[kB]); };
globalThis.holder = { Thing };
const show = () => { const o = new globalThis.holder.Thing(1, 2); return [o.sum(), Reflect.ownKeys(o).map(String).join(), String(kA), String(kB), kA === kB].join(" | "); };
console.log(show());
