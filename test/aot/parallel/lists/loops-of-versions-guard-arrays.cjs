// STATISTIC: LoopsReversionedForOtherIndexingType >= 1
// The loops of a version of a body ask for the storage of their arrays themselves.
"use strict";
const out = [];
function shift(h, t) {
  for (let i = 1; i < h.length; i++) h[i - 1] = h[i];
  h[h.length - 1] = t & 127;
  return h[0];
}
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((i * 37) & 63);
  return a;
}
const holders = [list(16), new Int32Array(list(16)), list(3), new Int32Array(list(5)), [1, , 3, 4], [0.5, 1.5, 2.5], Object.freeze([1, 2, 3])];
for (let t = 0; t < 50; t++) {
  for (const h of holders) {
    try {
      out.push(shift(h, t));
    } catch (e) {
      out.push(e.constructor.name);
    }
  }
}
for (const h of holders) out.push(h.constructor.name + " " + Array.from(h, String).join());
for (const line of out) console.log(line);
