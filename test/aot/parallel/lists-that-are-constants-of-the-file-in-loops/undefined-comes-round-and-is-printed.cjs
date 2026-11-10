// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; table[0] = 1; table[2] = 3; table[4] = 5;
function last(n) { let seen, before; for (let i = 0; i < n; i++) { before = seen; seen = table[i]; } return String(before) + "|" + String(seen); }
function step(r) { return last(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
