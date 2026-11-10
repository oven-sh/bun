// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
// STATISTIC: ParametersThatAbsentElementsAloneWidened >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }
function row(b, j, n) { let temp = j, result = j + 1, temp2, i; for (i = 0; i < n; i++) { temp2 = b === cache[i] ? temp : temp + 1; temp = table[i]; result = table[i] = temp > result ? (temp2 > result ? result + 1 : temp2) : temp2 > temp ? temp + 1 : temp2; } return result; }
function show() { return JSON.stringify(table) + table.length; }
fresh(5);
function step(r) { if (r === 6) table[3] = "x"; if (r === 9) cache[1] = "b"; return row(98, r & 1, 5) + show(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
