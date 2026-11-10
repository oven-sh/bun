// A class below Promise: its methods are called in a loop, and then() makes more of its kind.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class H extends Promise { constructor(run) { super(run); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new H(resolve => resolve(5));
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + one.two() + one.three()) & 4095; return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003;
one.then(v => { const next = one.then(w => w + 1); console.log(sum, v, next instanceof H, next.n, next.two()); });
