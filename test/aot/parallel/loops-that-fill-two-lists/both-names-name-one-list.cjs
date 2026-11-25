// STATISTIC: LaterStoreBoundsChecksHoisted >= 1
"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k); return l; }

function fill(a, b, n, by) { let s = 0; for (let i = 0; i < n; i++) { a[i] = (i * by) | 0; b[i] = (a[i] + 1) | 0; s += a[i]; } return s + "|" + a.join(); }
function step(r) { const l = fresh(6); return fill(l, r & 1 ? l : fresh(6), 6, r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
