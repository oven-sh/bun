// STATISTIC: LaterStoreBoundsChecksHoisted >= 1
"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k); return l; }

function fill(a, b, c, n) { for (let i = 0; i < n; i++) { a[i] = i + 1; b[i] = i + 2; c[i] = i + 3; } return [a.length, b.length, c.length, c.join()].join("|"); }
function step(r) { return fill(fresh(7), fresh(7), fresh(r >> 1), 7); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
