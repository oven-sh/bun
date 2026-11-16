// A class below Error: a message moves the class's own field by one place: where the field lies is learned once, and the other structure is refused.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: counter:BuiltinSubclassStructuresRejected >= 1
"use strict";
class E extends Error { constructor(message) { super(message); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const a = new E(), b = new E("m");
function f(t) { const e = t & 1 ? a : b; let s = 0; for (let i = 0; i < 16; i++) s += e.two() + e.three(); return s + e.message.length; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
