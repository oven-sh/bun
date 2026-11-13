"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 % 7); return l; }

function mark(l, n, b) { let c = 0; for (let i = 0; i < n; i++) { if (l[i] > b) c++; l[i] = c; } return c + JSON.stringify(l); }
function step(r) { const l = fresh(8); if (r & 1) delete l[r >> 1]; return mark(l, 5 + (r & 3), r % 5); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
