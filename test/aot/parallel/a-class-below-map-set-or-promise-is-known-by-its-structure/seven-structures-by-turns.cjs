// More structures by turns than a class has words for.
// COUNT: counter:StructuresOfHeirsRemembered >= 7
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const all = []; for (let k = 0; k < 7; k++) { const h = new H(); for (let j = 0; j < k; j++) h['m' + k + j] = j; h.n = k; all.push(h); } function make(t) { return all[t % 7]; }
function change(h, i) { }
function f(h, t, when) { let s = t & 1; for (let i = 0; i < 64; i++) { if (i === when) change(h, i); s = (s + h.two() + h.three()) & 4095; } return s; }
const when = +(process.argv[2] ?? 37); let sum = 0; const said = [];
for (let t = 0; t < 300; t++) { const h = make(t); let got; try { got = f(h, t, t === 250 ? when : -1); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else said.push(got); }
console.log(sum, said.join(","));
