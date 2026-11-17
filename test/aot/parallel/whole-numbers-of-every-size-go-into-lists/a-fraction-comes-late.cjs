"use strict";
const table = [];
function fill(n, by) { let v = 0; for (let i = 0; i < n; i++) { table[i] = v; v += by; } let s = 0; for (let i = 0; i < n; i++) s += table[i]; return s + JSON.stringify(table); }
function step(r) { return fill(6, r === 7 ? 0.5 : 1 + (r & 1)); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
