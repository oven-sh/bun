// Loops of two to nine turns over lists of every kind, views, texts and records, under keys that are elements, fractions, texts and nothing.
"use strict";
const lists = [[1, 2, 3], [0.5, 1.5, 2.5], ["a", "b", "c"], [1, , 3], [1, "x", 0.5], [null, undefined, {}], new Int32Array([4, 5, 6]), new Float64Array([0.5, 1]), "text", { 0: 7, 1: 8, length: 2 }, Object.freeze([9, 8, 7]), [], [[1], [2], [3]]], keys = [[2, 1, 0], [0.5, 1, 2], [undefined, 0, 1], ["1", "length", 0], [-1, 5, 1]];
const show = v => typeof v + (Object.is(v, -0) ? "-0" : typeof v === "object" ? JSON.stringify(v) : String(v)), out = [];
function two(a, b) { let s = 0; for (let i = 0; i < 2; i++) s += a[b[i]]; return s; }
function three(a, b) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s; }
function eight(a, b) { let s = 0; for (let i = 0; i < 8; i++) s += a[b[i % 3]]; return s; }
function down(a, b) { let s = 0; for (let i = 7; i >= 0; i--) s += a[(i + b[0]) % 3]; return s; }
function nine(a, b) { let s = 0; for (let i = 0; i < 9; i++) s += a[b[i % 3] | 0]; return s; }
function stores(a, b) { const c = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 8; i++) c[i] = a[i % 3]; for (let i = 0; i < 8; i++) b[i & 1] = c[7 - i]; return c.map(show).join() + b.length; }
function grows(a) { const l = a.slice ? Array.from(a) : []; for (let i = 0; i < 8; i++) l[i + 1] = l[i % 3]; return l.length + show(l[8]); }
function stops(a, b) { for (let i = 0; i < 8; i++) if (a[b[i % 3]] === undefined) return i; return -1; }
for (let r = 0; r < 20; r++) { out.length = 0; for (const a of lists) for (const k of keys) for (const f of [two, three, eight, down, nine, stops, (x, y) => stores(x, y.slice()), grows]) { try { out.push(show(f(a, k))); } catch (e) { out.push(e.name); } } }
let h = 0; for (const x of out) for (let i = 0; i < x.length; i++) h = (Math.imul(h, 31) + x.charCodeAt(i)) | 0; console.log(out.length, h, out.slice(0, 60).join("|"));
