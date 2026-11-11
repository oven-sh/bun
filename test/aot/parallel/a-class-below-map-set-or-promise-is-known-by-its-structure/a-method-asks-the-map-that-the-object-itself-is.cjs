// A method of a class below Map asks the map that the object itself is: get, has, set and size go by the built-in's own rows behind the look at the structure.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
class H extends Map { constructor() { super(); this.hits = 0; } look(k) { return this.get(k); } keep(k, v) { if (!this.has(k)) this.set(k, v); return this.size; } }
const one = new H();
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + one.keep(i & 7, i) + one.look(i & 7)) & 4095; return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0;
for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003;
console.log(sum, one.size);
