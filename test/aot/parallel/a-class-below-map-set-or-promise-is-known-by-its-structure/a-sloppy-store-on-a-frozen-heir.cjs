// A sloppy store into a frozen object changes nothing and throws nothing.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: counter:BuiltinSubclassStructuresRejected >= 1
function make() { "use strict"; return class H extends Map { constructor() { super(); this.n = 1; } two() { return this.n + 1; } }; }
const H = make(); const one = new H();
function f(t) { if (t === 150) Object.freeze(one); var s = 0; for (var i = 0; i < 8; i++) { one.n = i; s += one.two(); } return s; }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 6) said.push(String(got)); }
console.log(sum, said.join(","), String(one.n));
