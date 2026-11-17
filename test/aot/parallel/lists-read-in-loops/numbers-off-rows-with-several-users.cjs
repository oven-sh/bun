"use strict";
const out = [];
const fractions = [], whole = [], zeros = [], odd = [], torn = [], large = [];
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 3; j++) row.push(i + j * 0.25); fractions.push(row); }
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 3; j++) row.push(i * 3 + j); whole.push(row); }
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 3; j++) row.push(i & 1 ? -0 : 0); zeros.push(row); }
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 3; j++) row.push(i === 3 ? NaN : i === 5 ? Infinity : i - j); odd.push(row); }
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < (i === 4 ? 1 : 3); j++) row.push(i + j * 0.5); torn.push(row); }
for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 3; j++) row.push(2147483647 - i + j); large.push(row); }
function moments(d, a, b) { let sa = 0, sb = 0, ab = 0, aa = 0, below = 0; for (let i = 0; i < d.length; i++) { const x = d[i][a], y = d[i][b]; sa += x; sb += y; ab += x * y; aa += x * x; below += x < y ? 1 : 0; } return [sa, sb, ab, aa, below].map(v => Object.is(v, -0) ? "-0" : String(v)).join(" "); }
function kept(d, a) { let s = 0, last; for (let i = 0; i < d.length; i++) { const x = d[i][a]; s += x; s -= x / 2; last = x; } return String(s) + " " + typeof last + " " + String(last); }
for (const d of [fractions, whole, zeros, odd, torn, large]) { out.push(moments(d, 0, 1), moments(d, 1, 2), moments(d, 2, 5), kept(d, 1), kept(d, 7)); }
console.log(out.join("\n"));
