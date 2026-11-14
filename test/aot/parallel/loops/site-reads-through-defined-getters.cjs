// STATISTIC: SiteCachedReadsEmitted >= 1
// The getter is a function of a descriptor; the read of its name stays in the loop that stores into its field.
"use strict";
const change = (text, ...given) => new Function("a", text)(...given);
const P0 = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ mode: 1 }));
Object.defineProperty(P0, "mode", { configurable: true, get: function () { return this._mode; } });
const mk0 = k => { const o = Object.create(P0); o._mode = k; return o; };
const l1 = Array.from({ length: 9 }, (_, i) => mk0(i));
function bump(o, x) { o._mode += x; }
function f3(n) { let c = 0; const r = l1[0]; for (let i = 0; i < n; i++) { c += r.mode; l1[0]._mode++; } return c % 100000; }
const said = [];
for (let k = 0; k < 60; k++) said.push(f3(16));
change("Object.defineProperty(a, 'mode', { get() { return 1; } })", P0);
console.log(said.join(" "));
