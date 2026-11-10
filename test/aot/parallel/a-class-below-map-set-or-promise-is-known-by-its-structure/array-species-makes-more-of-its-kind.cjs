// A class below Array: map() and slice() make more of its kind.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
"use strict";
class A extends Array { constructor(...all) { super(...all); this.n = 1; } two() { return this.n + 1; } three() { return this.n + this.length; } }
const one = A.from([1, 2, 3]);
function f(t) { const more = one.map(x => x + t); const part = more.slice(1); return more.two() + more.three() * 10 + part.three() * 100 + (part instanceof A ? 1000 : 0); }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 5) said.push(String(got)); }
console.log(sum, said.join(","));
