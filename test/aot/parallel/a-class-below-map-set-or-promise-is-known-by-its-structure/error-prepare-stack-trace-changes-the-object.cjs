// A class below Error: the read of the stack runs the program's own function, which stores the field.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
"use strict";
class E extends Error { constructor(message) { super(message); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
Error.prepareStackTrace = function (error, sites) { error.n = 50; return "made"; };
const one = new E("m");
function f(t) { let s = 0; for (let i = 0; i < 8; i++) { s += one.two(); if (t === 150 && i === 3) s += one.stack.length; s += one.three(); } return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
