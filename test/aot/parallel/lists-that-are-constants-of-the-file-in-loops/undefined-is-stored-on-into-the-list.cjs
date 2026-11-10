// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function shift(n) { let carried; for (let i = 0; i < n; i++) { const here = table[i + 1]; table[i] = carried === undefined ? here : carried; carried = here; } return JSON.stringify(table); }
function step(r) { fresh(6); return shift(r & 7); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
