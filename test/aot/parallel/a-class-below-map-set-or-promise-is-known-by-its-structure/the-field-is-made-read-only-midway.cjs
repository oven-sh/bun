// A field that is made read-only refuses the store from then on: a strict store throws.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: counter:StructuresOfHeirsRefused >= 1
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } bump() { this.n = (this.n + 1) & 1023; return this.n; } two() { return this.n + 1; } put(v) { this.n = v; } }
const one = new H();
function f(t) { if (t === 150) Object.defineProperty(one, "n", { writable: false }); let s = 0; for (let i = 0; i < 8; i++) s += one.bump(); return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 6) said.push(String(got)); }
console.log(sum, said.join(","), String(one.n));
