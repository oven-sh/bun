// STATISTIC: StoringLoopHoleChecksRemoved >= 2
"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 % 7); return l; }
function mark(l, m, n, b) { let c = 0; for (let i = 0; i < n; i++) { if (l[i] === b) c++; m[i] = c; } return c + JSON.stringify(m); }
function either(l, m, n, b) { let c = 0; for (let i = 0; i < n; i++) { if (l[i] === b) c++; m[i] = c; } return c + JSON.stringify(m); }
function below(l, m, n, b) { let c = 0; for (let i = 0; i < n; i++) { if (l[i] < b) c++; m[i] = c; } return c + JSON.stringify(m); }
function step(r) { const l = fresh(8), m = fresh(12); return mark(l, m, 7 + (r & 3), r % 5) + either(l, m, 7 + (r & 3), r % 3 ? r % 5 : undefined) + below(l, m, 7 + (r & 3), r % 5); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
