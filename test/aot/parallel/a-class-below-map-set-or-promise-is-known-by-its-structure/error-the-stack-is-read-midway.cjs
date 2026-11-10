// A class below Error: the first read of the stack lays names on the object late.
// COUNT: counter:StructuresOfHeirsRemembered >= 2
"use strict";
class E extends Error { constructor(message) { super(message); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new E("m");
function f(t) { let s = 0; if (t === 150) s += typeof one.stack === "string" ? 1 : 2; for (let i = 0; i < 16; i++) s += one.two() + one.three(); return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
