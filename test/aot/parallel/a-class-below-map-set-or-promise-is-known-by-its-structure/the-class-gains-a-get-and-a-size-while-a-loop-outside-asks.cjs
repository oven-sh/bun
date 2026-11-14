// The prototype object of the class gains a get and an accessor under size midway, and loses them again: no method of the class stands between the loop and the map.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class H extends Map { constructor() { super(); this.hits = 0; } }
const one = new H(); for (let k = 0; k < 8; k++) Map.prototype.set.call(one, k, k);
function f(t) { let s = t & 1; for (let i = 0; i < 16; i++) s = (s + one.get(i & 7) + one.size) & 65535; return s; }
let sum = 0;
for (let t = 0; t < 400; t++) { sum = (sum + f(t)) % 1000003; if (t === 200) H.prototype.get = function (k) { return 100; }; if (t === 250) Object.defineProperty(H.prototype, "size", { get() { return 9; }, configurable: true }); if (t === 300) { delete H.prototype.get; delete H.prototype.size; } }
console.log(sum);
