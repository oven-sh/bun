"use strict";
function fresh(n) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 % 7); return l; }

function count(l, n, b) { let a = 0, c = 0, d = 0; for (let i = 0; i < n; i++) if (l[i] === b) a++; for (let i = 0; i < n; i++) if (l[i] !== b) c++; for (let i = 0; i < n; i++) if (l[i] >= b) d++; return [a, c, d].join(); }
function step(r) { const l = fresh(8); l[2] = NaN; l[3] = 0.5; if (r & 1) delete l[5]; return count(l, 9, r % 3 ? r % 5 : NaN); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
