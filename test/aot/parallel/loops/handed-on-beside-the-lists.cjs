"use strict";
const A = [0.5, 1.5, 2.5].map(v => v * 2), B = [1, 2, 3].map(v => v / 2);
let SCALE = 2.5, made = 0;
const twice = v => v * 2;
function scaled(a, b, k) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i] * k; return s; }
function through(a, b, g) { let s = 0; for (let i = 0; i < 3; i++) s += g(a[i] * b[i]); return s; }
function held(a, b, o) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + (o ? o.more : 0); }
function withAScale(turns) { let s = 0; for (let k = 0; k < turns; k++) s += scaled(A, B, SCALE); return s; }
function withAFunction(turns) { let s = 0; for (let k = 0; k < turns; k++) s += through(A, B, twice); return s; }
function withARecord(turns) { let s = 0; for (let k = 0; k < turns; k++) s += held(A, B, RECORD); return s; }
const out = [];
const say = run => { try { out.push(String(run())); } catch (error) { out.push(error.constructor.name); } };
say(() => withARecord(0)); say(() => withARecord(1));
const RECORD = { get more() { made++; return 0.25; } };
for (const turns of [0, 1, 5]) { say(() => withAScale(turns)); say(() => withAFunction(turns)); say(() => withARecord(turns)); SCALE += 1; }
console.log(out.join(" | "), made);
