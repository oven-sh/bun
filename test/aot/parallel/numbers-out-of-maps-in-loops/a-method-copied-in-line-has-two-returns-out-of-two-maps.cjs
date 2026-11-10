// Two returns of a method copied in line meet behind the call: what has met is asked for a number.
// STATISTIC: MapResultsGuardedAsNumbers >= 1
"use strict";
class H extends Map { constructor() { super(); this.other = new Map(); } look(k) { if (k & 1) return this.other.get(k); return this.get(k); } }
const one = new H(); for (let k = 0; k < 8; k++) { one.set(k, k === 4 ? "4" : k); one.other.set(k, k === 3 ? "3" : k * 2); }
function f(t) { let s = 0; for (let i = 0; i < 16; i++) s = (s + one.look(i & 7)) & 4095; return s; }
let sum = 0; for (let t = 0; t < 300; t++) sum += f(t); console.log(sum);
