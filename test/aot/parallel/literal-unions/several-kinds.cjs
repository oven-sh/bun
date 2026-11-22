"use strict";
let kept = { v: 0, n: 0 }; const list = []; class K { constructor(v) { this.v = v; } }
function pick(i) { return ["a", i, null, "b", undefined][i % 5]; }
function show(v) { return typeof v + ":" + String(v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : v); }
function store(n) { let r = ""; for (let i = 0; i < n; i++) { kept = { v: ["a", i, null, "b", undefined][i % 5], n: i }; list[i & 7] = { v: ["a", i, null, "b", undefined][i % 5], w: i }; const k = new K(["a", i, null, "b", undefined][i % 5]); kept.v = ["a", i, null, "b", undefined][i % 5]; r += show(kept.v) + show(list[i & 7].v) + show(k.v) + ";"; } return r; }
function local(n) { let x = "start", r = ""; for (let i = 0; i < n; i++) { x = ["a", i, null, "b", undefined][i % 5]; r += show(x); const o = { x }; r += show(o.x) + (o.x === x || o.x !== o.x); } return r; }
function typed(n) { let r = ""; for (let i = 0; i < n; i++) { const o = { v: ["a", i, null, "b", undefined][i % 5] }; r += typeof o.v === "number" ? "n" + (o.v + 1) : typeof o.v === "string" ? "s" + o.v.length + o.v : show(o.v); } return r; }
function result(n) { let r = ""; for (let i = 0; i < n; i++) r += show(pick(i)); return r; }
console.log(store(11)); console.log(local(11)); console.log(typed(11)); console.log(result(11)); console.log([0, 1, 2, 3, 4].map(i => show(["a", i, null, "b", undefined][i % 5])).join());
