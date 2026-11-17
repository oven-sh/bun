"use strict";
let table = []; const first = table; const other = []; for (let k = 0; k < 6; k++) { table[k] = k + 1; other[k] = 60 - 10 * k; }
function swap(i, r) { if (i === (r % 7)) table = table === first ? other : first; }
function sum(n, r) { let s = 0; for (let i = 0; i < n; i++) { swap(i, r); s = s * 3 + table[i]; } return s; }
function step(r) { return sum(6, r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
