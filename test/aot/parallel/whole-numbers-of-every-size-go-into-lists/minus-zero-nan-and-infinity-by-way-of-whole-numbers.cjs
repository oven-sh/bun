// STATISTIC: WholeNumbersStoredOutOfLineAsTheyAre >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function put(text, n) { for (let i = 0; i < n; i++) table[i] = text.charCodeAt(i); }
function zero(n, f) { for (let i = 0; i < n; i++) table[i] = Math.round(f * (i & 1)); }
function step(r) { fresh(5); if (r & 1) put("ab", 2 + (r >> 1)); else zero(4, r & 2 ? -0.2 : 3); return table.map((v) => Object.is(v, -0) ? "-0" : String(v)).join(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
