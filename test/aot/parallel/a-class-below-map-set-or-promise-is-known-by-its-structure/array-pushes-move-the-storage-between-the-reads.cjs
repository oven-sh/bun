// A class below Array: pushes move the storage between the reads of the field: the field lies at the same distance in front of it.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: counter:StructuresOfHeirsRefused = 0
"use strict";
class A extends Array { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + this.length; } }
const one = new A();
function f(t) { let s = t & 1; for (let i = 0; i < 64; i++) { one.push(i); s = (s + one.two() + one.three()) & 4095; } if (one.length > 5000) one.length = 0; return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
