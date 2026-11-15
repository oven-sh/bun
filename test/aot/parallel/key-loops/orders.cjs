"use strict";
const recs = []; for (let i = 0; i < 8; i++) recs.push(i & 1 ? { a: i, b: 2 } : { b: 3, a: i });
const out = [];
function plain(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); for (const k of ks) out.push(k, o[k]); } }
function reorder(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); const a = o.a; delete o.a; o.a = a; for (const k of ks) out.push(k, o[k]); } }
function other(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7], p = recs[(i + 1) & 7]; const ks = Object.keys(o); const a = p.a; delete p.a; p.a = a; for (const k of ks) out.push(k, o[k]); } }
function same(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7], p = recs[i & 7]; const ks = Object.keys(o); const a = p.a; delete p.a; p.a = a; for (const k of ks) out.push(k, o[k]); } }
function turn(o) { const a = o.a; delete o.a; o.a = a; }
function called(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); turn(o); for (const k of ks) out.push(k, o[k]); } }
function inside(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; for (const k of Object.keys(o)) { out.push(k, o[k]); turn(o); } } }
function outside(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); for (let j = 0; j < 2; j++) { for (const k of ks) out.push(k, o[k]); if (j === 0) turn(o); } } }
function maybe(n) { for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); if (i & 2) turn(o); for (const k of ks) out.push(k, o[k]); } }
function sum(n) { let s = 0; for (let i = 0; i < n; i++) { const o = recs[i & 7]; const ks = Object.keys(o); if (i & 2) turn(o); let w = 1; for (const k of ks) { s += o[k] * w; w *= 10; } } return s; }
for (const f of [plain, reorder, plain, other, plain, same, plain, called, plain, inside, plain, outside, plain, maybe, plain]) { f(9); console.log(f.name, out.join()); out.length = 0; }
console.log(sum(9), sum(8));
