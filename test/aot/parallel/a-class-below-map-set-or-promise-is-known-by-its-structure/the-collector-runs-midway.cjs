// The collector runs between a look and the reads behind it: where the fields lie is never forgotten, which structures pass is.
// COUNT: counter:StructuresOfHeirsRemembered >= 2
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new H(); function make(t) { return one; }
function change(h, i) { Bun.gc(true); }
function f(h, t, when) { let s = t & 1; for (let i = 0; i < 64; i++) { if (i === when) change(h, i); s = (s + h.two() + h.three()) & 4095; } return s; }
const when = +(process.argv[2] ?? 37); let sum = 0; const said = [];
for (let t = 0; t < 300; t++) { const h = make(t); let got; try { got = f(h, t, t === 250 ? when : -1); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else said.push(got); }
console.log(sum, said.join(","));
