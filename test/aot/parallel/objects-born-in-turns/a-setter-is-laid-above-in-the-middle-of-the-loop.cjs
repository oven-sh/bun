// The guard of the constructor's store is asked in front of the loop; a call in the turn lays a setter above the objects half way. What is printed is what plain Bun prints.
"use strict";
const Meter = class { constructor(v) { this.v = v; } };
globalThis.kept = Meter;
const seen = [];
const steps = [() => {}, i => { if (i === 32) Object.defineProperty(globalThis.kept.prototype, "v", { set(x) { if (x > 61) seen.push(x); }, get() { return 2; }, configurable: true }); }];
function total(t) { let s = t & 1; for (let i = 0; i < 64; i++) { steps[t & 1](i); s = (s + new Meter(i).v) | 0; } return s; }
console.log(total(0), total(1), seen.join(), total(2));
