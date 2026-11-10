// The prototype object of the class is laid below an object with a get, a has and a size of its own, and back below Map.prototype.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class H extends Map { constructor() { super(); this.hits = 0; } }
const one = new H(); for (let k = 0; k < 8; k++) Map.prototype.set.call(one, k, k);
const other = { get(k) { return 100; }, has(k) { return "other"; }, get size() { return 500; } };
function f(t) { let s = t & 1; for (let i = 0; i < 16; i++) s = (s + one.get(i & 7) + (one.has(i) === true ? 1 : 0) + one.size) & 65535; return s; }
let sum = 0;
for (let t = 0; t < 400; t++) { sum = (sum + f(t)) % 1000003; if (t === 200) Object.setPrototypeOf(H.prototype, other); if (t === 300) Object.setPrototypeOf(H.prototype, Map.prototype); }
console.log(sum);
