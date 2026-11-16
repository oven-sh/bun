"use strict";
const out = [], show = v => (typeof v === "number" && Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "[" + Array.from(v, (x, i) => (i in v ? show(x) : "hole")).join() + "]" : String(v)), t = f => { try { out.push(show(f())); } catch (e) { out.push(e.name); } }, id = x => [x][JSON.parse("0")];
function swap(a, i, j) { const x = a[i]; a[i] = a[j]; a[j] = x; }
function turn(a) { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
function rotate(a) { const f = a[0]; for (let i = 0; i + 1 < a.length; i++) a[i] = a[i + 1]; if (a.length) a[a.length - 1] = f; return a; }
function insert(a) { for (let i = 1; i < a.length; i++) { const x = a[i]; let j = i; while (j > 0 && a[j - 1] > x) { a[j] = a[j - 1]; j--; } a[j] = x; } return a; }
function scaled(a, k) { for (let i = 0, j = a.length - 1; i < j; i++, j--) { const x = a[i] * k; a[i] = a[j]; a[j] = x; } return a; }
const D = () => [1.5, 2.5, -0, 1e308, 0.1, 7.25, -3.5];
for (let r = 0; r < 30; r++) { turn(D()); rotate(D()); insert(D()); scaled(D(), 1.5); }
for (const f of [turn, rotate, insert, a => scaled(a, 2), a => scaled(a, NaN), a => scaled(a, Infinity), a => { swap(a, 0, 1); swap(a, 1, 1); return a; }]) for (let r = 0; r < 4; r++) t(() => f(Object.freeze(D())));
for (const f of [turn, rotate, insert, a => scaled(a, 2), a => scaled(a, NaN), a => scaled(a, Infinity), a => { swap(a, 0, 1); swap(a, 1, 1); return a; }]) for (let r = 0; r < 4; r++) t(() => f(D().slice()));
console.log(out.join(" "));
