// STATISTIC: KeysOfLaterStoresAskedInFrontOfTheFirst >= 1
"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k); return l; }

function fill(a, b, n, by) { for (let i = 0; i < n; i++) { a[i] = (i * by) | 0; b[i] = (i + by) | 0; } return a.join() + "|" + a.length + "|" + b.join(); }
function step(r) { return fill(fresh(r & 7), fresh(8), 8, r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
