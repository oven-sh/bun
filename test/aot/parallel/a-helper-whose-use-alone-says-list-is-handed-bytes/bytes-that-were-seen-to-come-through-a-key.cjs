"use strict";
// STATISTIC: LoopsBuiltForListsAndForBytes >= 2
// The callers in sight hand over bytes alone, by a key that is known at run time alone. One guess in front of the loop left the question "as made?" and the length in every turn; the loop asks in front for a list, a Buffer and a Uint8Array as it does where nothing was seen.
const names = JSON.parse('["crc","add"]');
const algorithms = {
  crc(d) { let h = 7; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; },
  add(d) { let h = 0; for (let i = 0; i < d.length; i++) { d[i] = d[i] + 250; h = (h + d[i]) | 0; } return h; },
};
const u = new Uint8Array(40).fill(7);
function f(t) { u[0] = t; return algorithms[names[t & 1]](u) >>> 8; }
let sum = 0;
for (let t = 0; t < 300; t++) sum = (sum + f(t)) % 1000003;
console.log(sum, u.join());
