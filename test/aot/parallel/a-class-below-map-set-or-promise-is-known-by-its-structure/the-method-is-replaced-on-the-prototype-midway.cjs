// Midway through a loop the method is replaced on the class's prototype: the guard beside the look answers for that.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new H(); function make(t) { return one; }
function change(h, i) { H.prototype.two = function () { return this.n + 7; }; }
function f(h, t, when) { let s = t & 1; for (let i = 0; i < 64; i++) { if (i === when) change(h, i); s = (s + h.two() + h.three()) & 4095; } return s; }
const when = +(process.argv[2] ?? 37); let sum = 0; const said = [];
for (let t = 0; t < 300; t++) { const h = make(t); let got; try { got = f(h, t, t === 250 ? when : -1); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else said.push(got); }
console.log(sum, said.join(","));
