// STATISTIC: SiteCachedReadsEmitted >= 1
// A getter of length returns a field that the loop stores into.
"use strict";
const change = (text, ...given) => new Function("a", text)(...given);
const P0 = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ get length() { return this._n; }, set length(x) { this._n = x; } }));
const mk0 = k => { const o = Object.create(P0); o._n = k; return o; };
const l1 = Array.from({ length: 9 }, (_, i) => mk0(i + 20));
function f3(n) { let c = 0; for (const r of l1) { r._n = 20; for (let i = 0; i < r.length; i++) { c += i; if (i & 1) r._n--; } } return c; }
const said = [];
for (let k = 0; k < 60; k++) said.push(f3(16));
change("Object.defineProperty(a, \"length\", { get() { return 1; } })", P0);
said.push(f3(16));
console.log(said.join(" "));
