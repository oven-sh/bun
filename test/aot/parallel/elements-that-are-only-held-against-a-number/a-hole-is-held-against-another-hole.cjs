"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 % 7); return l; }

function count(l, m, n) { let a = 0, c = 0; for (let i = 0; i < n; i++) if (l[i] === m[i]) a++; for (let i = 0; i < n; i++) if (l[i] < m[i]) c++; return a + ":" + c; }
function step(r) { const l = fresh(8), m = fresh(8); if (r & 1) delete l[r >> 1]; if (r & 2) delete m[r >> 1]; m[1] = r; return count(l, m, 6 + (r & 7)); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
