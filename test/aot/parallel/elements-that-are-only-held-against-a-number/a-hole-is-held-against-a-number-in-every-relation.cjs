"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 % 7); return l; }

function count(l, n, b) { let lt = 0, le = 0, gt = 0, ge = 0; for (let i = 0; i < n; i++) if (l[i] < b) lt++; for (let i = 0; i < n; i++) if (l[i] <= b) le++; for (let i = 0; i < n; i++) if (b < l[i]) gt++; for (let i = 0; i < n; i++) if (b <= l[i]) ge++; return [lt, le, gt, ge].join(); }
function step(r) { const l = fresh(8); if (r & 1) delete l[r >> 1]; return count(l, 6 + (r & 7), r % 5); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
