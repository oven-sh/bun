// Between two calls the object is laid below another prototype by a built-in called in line: what the look showed ends there.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: counter:BuiltinSubclassStructuresRejected >= 1
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } three() { return this.n + 2; } }
const one = new H(); function make(t) { return one; }
const other = { two() { return 5; }, three() { return 6; } };
function f(h, t, when) { const a = h.two(); if (t === when) Object.setPrototypeOf(h, other); const b = h.two(); const c = h.three(); return a * 10000 + b * 100 + c; }
const when = +(process.argv[2] ?? 250); let sum = 0; const said = [];
for (let t = 0; t < 300; t++) { const h = make(t); let got; try { got = f(h, t, when); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else said.push(got); }
console.log(sum, said.join(","));
