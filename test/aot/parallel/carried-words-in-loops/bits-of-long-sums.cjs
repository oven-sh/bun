// STATISTIC: SumsTruncatedWithoutTests >= 4
// The bits of a sum of many integers are the bits of the integer sum while no partial sum is rounded. Terms of 2 ** 51 and more, fractions and NaN are added as numbers
"use strict";
function u(a, b) {
  var c, d, e, f = a.F, g = a.b, h = f[0], k = f[1], l = f[2], n = f[3], m = f[4], p = f[5], r = f[6], q = f[7];
  for (c = 0; 64 > c; c++) 16 > c ? d = b[c] : (d = b[c + 1 & 15], e = b[c + 14 & 15], d = b[c & 15] = (d >>> 7 ^ d >>> 18 ^ d >>> 3 ^ d << 25 ^ d << 14) + (e >>> 17 ^ e >>> 19 ^ e >>> 10 ^ e << 15 ^ e << 13) + b[c & 15] + b[c + 9 & 15] | 0), d = d + q + (m >>> 6 ^ m >>> 11 ^ m >>> 25 ^ m << 26 ^ m << 21 ^ m << 7) + (r ^ m & (p ^ r)) + g[c], q = r, r = p, p = m, m = n + d | 0, n = l, l = k, k = h, h = d + (k & l ^ n & (k ^ l)) + (k >>> 2 ^ k >>> 13 ^ k >>> 22 ^ k << 30 ^ k << 19 ^ k << 10) | 0;
  f[0] = f[0] + h | 0; f[1] = f[1] + k | 0; f[2] = f[2] + l | 0; f[3] = f[3] + n | 0; f[4] = f[4] + m | 0; f[5] = f[5] + p | 0; f[6] = f[6] + r | 0; f[7] = f[7] + q | 0;
}
const bits = {
  five(x, y, w, n) { let s = 0; for (let i = 0; i < n; i++) { s = (x ^ i) + (y & ~i) + (w[i & 7] | 0) + 1518500249 + i | 0; x = y; y = s; } return [s, x, y]; },
  differences(x, y, w, n) { let s = 0; for (let i = 0; i < n; i++) { s ^= (x ^ i) - (y | 0) - (w[i & 7] | 0) - 899497514 - (x >>> 0) + (y >>> 0); x = x + s | 0; } return [s, x]; },
  narrowed(x, y, w, n) { let s = 0, t = x; for (let i = 0; i < n; i++) { t = t + (y >>> 0) * 65536; if (t < 1000 && t > -1000) s ^= t + (x | 0) + (y | 0) + i; s ^= t + (x | 0) + (y | 0) + w[i & 7]; } return [s, t]; },
  carried(x, y, w, n) { let t = 0, s = 0; for (let i = 0; i < n; i++) { t = t + (w[i & 7] | 0) + (x >>> 0) * 1048576; s ^= t + (y | 0) + (x ^ i) + 7; if (t > 4503599627370496) t = t - 4503599627370497; } return [s, t]; },
  many(x, y, w, n) { let s = 0; for (let i = 0; i < n; i++) s = (x | 0) + (y | 0) + (x ^ i) + (y ^ i) + (x & i) + (y | i) + (x >>> 3) + (y >>> 5) + (w[i & 7] | 0) + (x << 1) + (y << 2) + (s ^ i) | 0; return [s]; },
};
const fill = (n, f) => { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; };
const word = i => Math.imul(i + 1, 0x9e3779b9) | 0, with9 = v => { const a = fill(16, word); a[9] = v; return a; };
const rings = {
  ints: () => fill(16, word), unsigned: () => fill(16, i => word(i) >>> 0), view: () => new Uint32Array(fill(16, word)), signed: () => new Int32Array(fill(16, word)), floats: () => new Float64Array(fill(16, i => word(i) * 65537)), wide: () => with9(1099511627776 + 5), widest: () => with9(2 ** 49), least: () => with9(-(2 ** 49)), over: () => with9(2 ** 49 + 1),
  rounded: () => with9(2 ** 52 + 1), largest: () => with9(2 ** 53 - 1), larger: () => with9(2 ** 60 + 2 ** 12), half: () => with9(0.5), nan: () => with9(NaN), zero: () => with9(-0), hole: () => { const a = fill(16, word); delete a[3]; return a; }, text: () => with9("77"), short: () => fill(5, word), object: () => with9({ valueOf() { return 3; } }),
};
const show = v => Object.is(v, -0) ? "-0" : typeof v === "object" ? "o" : String(v);
for (const name in rings) for (let round = 0; round < 3; round++) {
  const state = { F: [1, 2, round === 1 ? 2 ** 33 : 3, 4, 5, round === 2 ? 0.5 : 6, 7, 8], b: round === 2 ? fill(64, i => word(i) / 2) : fill(64, word) }, ring = rings[name](); let said;
  try { for (let turn = 0; turn < 3; turn++) { if (turn) ring[turn] = turn; u(state, ring); } said = state.F.map(show).join(); } catch (error) { said = error.name; }
  console.log(name, round, said, Array.from(ring, show).join());
}
for (const name in bits) for (const ring in rings) for (let round = 0; round < 4; round++) {
  let said; try { said = bits[name]([word(1), 5, -(2 ** 31), 2 ** 33][round], [3, word(4), 2 ** 31, 0.5][round], rings[ring](), 20).map(show).join(); } catch (error) { said = error.name; }
  console.log(name, ring, round, said);
}
