// A method stores the field that it and its neighbor read: the value that was read ends with the store.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { this.n = this.n + 1; return this.n; } three() { return this.n + 2; } }
const one = new H();
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + one.two() + one.three()) & 4095; return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003; console.log(sum, one.n);
