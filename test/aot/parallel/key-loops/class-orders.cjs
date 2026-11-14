"use strict";
class K { constructor(a, b) { this.a = a; if (b !== undefined) this.b = b; } }
class M { constructor(a, b, c) { this.a = a; if (b) this.b = b; if (c) this.c = c; } }
function between(o) { const ks = Object.keys(o); o.b = 5; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function removed(o) { const ks = Object.keys(o); delete o.b; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function two(o, p) { const ks = Object.keys(o); p.b = 5; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function called(o, f) { const ks = Object.keys(o); f(o); const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function branch(o, i) { const ks = Object.keys(o); if (i & 1) o.b = 9; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function inside(o) { const ks = Object.keys(o); const r = []; for (const k of ks) { r.push(k, o[k]); o.b = 7; } return r.join(); }
function again(o) { const r = []; for (let j = 0; j < 3; j++) { const ks = Object.keys(o); if (j === 1) o.b = j; for (const k of ks) r.push(k, o[k]); } return r.join(); }
function outside(o) { const ks = Object.keys(o); const r = []; for (let j = 0; j < 3; j++) { for (const k of ks) r.push(k, o[k]); o.b = j; } return r.join(); }
function made(i, b) { const o = new K(i, b); const ks = Object.keys(o); o.b = 5; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function madeTwo(i, b) { const o = new M(i, b, 0); const ks = Object.keys(o); o.c = 5; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function literal(i) { const o = { a: i }; const ks = Object.keys(o); o.b = 5; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function swapped(o) { const ks = Object.keys(o); const a = o.a; delete o.a; o.a = a; const r = []; for (const k of ks) r.push(k, o[k]); return r.join(); }
function grow(o) { o.b = 11; } function shrink(o) { delete o.b; }
let out = "";
for (let i = 0; i < 6; i++) {
  const b = i & 1 ? i : undefined;
  out += between(new K(i, b)) + ";" + removed(new K(i, b)) + ";" + called(new K(i, b), i & 2 ? grow : shrink) + ";" + branch(new K(i, b), i >> 1) + ";" + inside(new K(i, b)) + ";" + again(new K(i, b)) + ";" + outside(new K(i, b)) + ";" + made(i, b) + ";" + madeTwo(i, b) + ";" + literal(i) + ";" + swapped(new K(i, b)) + ";";
  const k = new K(i, b); out += two(k, k) + ";" + two(k, new K(1)) + "\n";
}
console.log(out);
