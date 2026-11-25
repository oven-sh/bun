"use strict";
const A = [0.5, 1.5, 2.5].map(v => v * 2), B = [1, 2, 3].map(v => v / 2);
const TABLE = { more: 0.25, less: 0.125 };
const LIST = [7, 8, 9];
class Kind { static more = 0.5; }
function helper(v) { return v * 2; }
function held(a, b, o) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + (o ? o.more : 0); }
function through(a, b, g) { let s = 0; for (let i = 0; i < 3; i++) s += g(a[i] * b[i]); return s; }
function counted(a, b, l) { let s = 0; for (let i = 0; i < 3; i++) s += a[i] * b[i]; return s + l.length; }
function withATable(turns) { let s = 0; for (let k = 0; k < turns; k++) s += held(A, B, TABLE); return s; }
function withAClass(turns) { let s = 0; for (let k = 0; k < turns; k++) s += held(A, B, Kind); return s; }
function withAHelper(turns) { let s = 0; for (let k = 0; k < turns; k++) s += through(A, B, helper); return s; }
function withAListThatIsNotRead(turns) { let s = 0; for (let k = 0; k < turns; k++) s += counted(A, B, LIST); return s; }
const out = [];
for (const turns of [0, 1, 5]) out.push(withATable(turns), withAClass(turns), withAHelper(turns), withAListThatIsNotRead(turns));
console.log(out.join(" | "));
