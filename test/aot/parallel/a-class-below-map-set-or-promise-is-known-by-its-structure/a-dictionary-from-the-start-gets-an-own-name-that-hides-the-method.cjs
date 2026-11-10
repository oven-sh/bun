// A dictionary keeps its structure while names come and go: it is never remembered.
// COUNT: counter:StructuresOfHeirsRefused >= 1
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new H(); for (let k = 0; k < 300; k++) one['k' + k] = k; for (let k = 0; k < 100; k++) delete one['k' + (299 - k)]; function make(t) { return one; }
function change(h) { h.two = function () { return 90; }; }
function f(h, t, when) { const a = h.two(); if (t === when) change(h); const b = h.two(); const c = h.three(); return a * 10000 + b * 100 + c; }
const when = +(process.argv[2] ?? 250); let sum = 0; const said = [];
for (let t = 0; t < 300; t++) { const h = make(t); let got; try { got = f(h, t, when); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else said.push(got); }
console.log(sum, said.join(","));
