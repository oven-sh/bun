// STATISTIC: ModuleConstantReadsHoisted >= 1
// STATISTIC: AbsentArrayElementWideningsAvoided >= 1
"use strict";
const table = []; table[0] = 4; table[1] = 3; table[3] = 1; table[4] = 0;
function chain(n) { let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { c = b; b = a; a = table[i]; } return [a, b, c].map(String).join(); }
function step(r) { return chain(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
