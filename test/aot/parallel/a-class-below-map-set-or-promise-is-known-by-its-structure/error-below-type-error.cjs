// A class below TypeError: the table tells its instances by no cell type of their own: no look is laid.
// COUNT: counter:BuiltinSubclassStructuresAccepted = 0
// COUNT: counter:BuiltinSubclassStructuresRejected = 0
"use strict";
class E extends TypeError { constructor(message) { super(message); this.n = 1; } two() { return this.n + 1; } }
const one = new E("m");
function f(t) { let s = 0; for (let i = 0; i < 16; i++) s += one.two(); return s + (one instanceof TypeError ? 1 : 0) + (one instanceof Error ? 2 : 0); }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
