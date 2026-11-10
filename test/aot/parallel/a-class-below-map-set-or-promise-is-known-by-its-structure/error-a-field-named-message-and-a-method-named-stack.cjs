// A class below Error with a method under a name that the built-in lays on its instances outside the structure: no look is laid.
// COUNT: counter:BuiltinSubclassStructuresAccepted = 0
// COUNT: counter:BuiltinSubclassStructuresRejected = 0
"use strict";
class E extends Error { constructor() { super("first"); this.message = "second"; this.n = 1; } stack() { return this.n + 5; } two() { return this.n + this.message.length; } }
const one = new E();
function f(t) { let s = 0; for (let i = 0; i < 16; i++) s += one.two() + (typeof one.stack === "function" ? one.stack() : 100); return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
