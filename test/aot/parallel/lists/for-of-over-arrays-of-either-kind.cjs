// STATISTIC: BodiesVersionedByArrayKind >= 2
// A for-of takes an array in some calls and a typed array in others.
"use strict";
const out = [];
function total(h) {
  let s = 0;
  for (const x of h) s = (s + x) | 0;
  return s;
}
function grow(h, other) {
  let s = 0, n = 0;
  for (const x of h) {
    s += x;
    if (++n === 3 && Array.isArray(h)) h.push(n);
    if (n === 4) h[5] = 100;
    if (n > 20) break;
    other[0] = s;
  }
  return s + ":" + n;
}
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((i * 37) & 63);
  return a;
}
const holders = [list(16), new Int32Array(list(16)), list(6), new Int32Array(list(9)), [], new Int32Array(0)];
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < holders.length; i++) out.push(total(holders[i]) + " " + grow(holders[i], holders[(i + round) % 6]));
}
const resized = new Int32Array(new ArrayBuffer(32, { maxByteLength: 64 }));
resized.set(list(8));
out.push(total(resized));
resized.buffer.resize(64);
out.push(total(resized), grow(resized, list(3)));
const moved = new Int32Array(list(5));
structuredClone(moved.buffer, { transfer: [moved.buffer] });
for (const h of [moved, holders[0]]) {
  try {
    out.push(total(h));
  } catch (e) {
    out.push(e.constructor.name);
  }
}
holders[1][Symbol.iterator] = function* () {
  yield 41;
};
out.push(total(holders[1]), total(holders[3]));
for (const h of holders) out.push(h.constructor.name + " " + Array.from({ length: h.length }, (_, i) => String(h[i])).join());
for (const line of out) console.log(line);
