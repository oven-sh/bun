// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
// STATISTIC: ParametersThatAbsentElementsAloneWidened >= 1
"use strict";
const table = []; for (let k = 0; k < 6; k++) if (k !== 3) table[k] = k * 2;
function run(n) { let held = 1, sum = 0; for (let i = 0; i < n; i++) { sum = sum + held; held = table[i]; } return String(sum) + "|" + String(held); }
function step(r) { return run(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
