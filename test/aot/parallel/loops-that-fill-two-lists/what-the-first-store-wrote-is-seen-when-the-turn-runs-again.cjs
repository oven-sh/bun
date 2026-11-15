"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k); return l; }

function fill(a, b, n) { let seen = ""; for (let i = 0; i < n; i++) { seen += a[i] + ","; a[i] = (a[i] + 10) | 0; b[i] = i | 0; } return seen + "|" + a.join() + "|" + b.join(); }
function step(r) { return fill(fresh(6), fresh(r % 7), 6); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
