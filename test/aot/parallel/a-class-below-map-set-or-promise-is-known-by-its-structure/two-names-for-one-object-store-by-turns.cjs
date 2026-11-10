// Two names hold one object and store by turns: a method called on either sees the newest store.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: operation:operationAOTFillSiteCache = 0
"use strict";
class H extends Map { constructor() { super(); this.n = 1; } bump() { this.n = (this.n + 1) & 1023; return this.n; } two() { return this.n + 1; } put(v) { this.n = v; } }
const one = new H();
const far = v => [v][JSON.parse("0")];
function g(a, b) { let s = 0; for (let i = 0; i < 16; i++) { a.n = i; s += b.two(); b.n = i + 100; s += a.two(); } return s; }
function f(t) { return g(far(one), far(one)); }
const turns = +(process.argv[2] ?? 300); let sum = 0; const said = [];
for (let t = 0; t < turns; t++) { let got; try { got = f(t); } catch (error) { got = "threw " + error.constructor.name; } if (typeof got === "number") sum = (sum + got) % 1000003; else if (said.length < 6) said.push(String(got)); }
console.log(sum, said.join(","), String(one.n));
