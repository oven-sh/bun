// STATISTIC: SiteCachedReadsEmitted >= 7
// A site answers a read with the field that a getter returns: a typed store into the field is seen by the next read of the name.
"use strict";
const change = (text, ...given) => new Function("a", text)(...given);
const P0 = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ get mode() { return this._mode; }, set mode(x) { this._mode = x; } }));
const mk0 = k => { const o = Object.create(P0); o._mode = k; return o; };
const l1 = Array.from({ length: 9 }, (_, i) => mk0(i));
function bump(o, x) { o._mode += x; }
function runz1(n) { let c = 0; for (let i = 0; i < n; i++) { const r = l1[i & 1]; c += r.mode; r._mode++; c += r.mode; } return c % 100000; }
function runz2(n) { let c = 0; for (let i = 0; i < n; i++) { const r = l1[i & 1]; c += r.mode; r._mode = (r._mode + i) % 1009; c += r.mode; } return c % 100000; }
function runz3(n) { let c = 0; for (let i = 0; i < n; i++) { const r = l1[i & 1]; c += r.mode; bump(r, i); c += r.mode; } return c % 100000; }
function runz4(n) { let c = 0; for (let i = 0; i < n; i++) { const r = l1[i & 1]; c += r.mode; l1[i & 1]._mode++; c += r.mode; } return c % 100000; }
function runz5(n) { let c = 0; const r = l1[0]; for (let i = 0; i < n; i++) { c += r.mode; l1[0]._mode++; } return c % 100000; }
function runz7(n) { let c = 0; for (const r of l1) { if (r._mode > 1e6) r._mode = 0; c += r.mode; r._mode = r._mode + 1; c += r.mode; } return c % 100000; }
function runz8(n) { let c = 0; for (let i = 0; i < n; i++) { const r = l1[i & 1], q = r; c += r.mode; q._mode = q._mode * 2 % 1001; c += r.mode; } return c % 100000; }
const all = [runz1, runz2, runz3, runz4, runz5, runz7, runz8], said = [];
for (let k = 0; k < 60; k++) said.push(all.map(run => run(16)).join(","));
change("Object.defineProperty(a, 'mode', { get() { return 1; } })", P0);
said.push(all.map(run => run(16)).join(","));
console.log(said.join("\n"));
