// w & (w - 1) and w >> n of a uint32 past 2 ** 31 are negative: the loop goes on.
const u = new Uint32Array([0xffffffff, 7, 0x80000000]);
function a1(v) { let w = v >>> 0, n = 0; while (w !== 0) { w = w & (w - 1); n++; if (n > 60) break; } return w + "|" + n; }
function a2(v) { let w = v >>> 0, n = 0; while (w !== 0 && n < 40) { w &= w - 1; n++; } return w + "|" + n; }
function a3(v) { let w = v >>> 0, n = 0; for (; w != 0 && n < 60; n++) w >>= 3; return w + "|" + n; }
function a4(v) { let w = v >>> 0, n = 0; for (; w !== 0 && n < 60; n++) w = w >> 1; return w + "|" + n; }
function a5(v) { let w = v >>> 0, n = 0; for (; w !== 0; n++) w >>>= 5; return w + "|" + n; }
function a6(v) { let w = v | 0, n = 0; while (w !== 0) { w &= w - 1; n++; } return w + "|" + n; }
function a7(v) { let w = u[v & 1 ? 0 : 2], n = 0; while (w != 0) { w &= w - 1; n++; } return w + "|" + n; }
function a8(v) { let w = (v >>> 0) + 1, n = 0; while (w !== 0 && n < 50) { w = w & (w - 1); n++; } return w + "|" + n; }
function a9(v) { let w = v >>> 0, n = 0; while (w > 0) { w &= w - 1; n++; } return w + "|" + n; }
function b1(v) { let w = v >>> 0, n = 0; while (w > 0) { w >>= 2; n++; } return w + "|" + n; }
function b2(v) { let w = v >>> 0, n = 0, s = 0; while (w !== 0) { n += w & 1; s += w; w >>>= 1; if (s > 1e300) break; } return w + "|" + n + "|" + s; }
// The counter stops falling at zero, and one that is negative rises by >>>.
const view = new Float64Array(64).map((_, i) => i * 0.5);
function c1(w, p) { let s = 0, g = 0; while (w > -5) { s += view[p++]; w >>= 1; if (++g > 70) break; } return s + "|" + p; }
function c2(w, i) { let s = 0, g = 0; while (i < w) { s += view[w]; w >>= 1; i++; if (++g > 70) break; } return s + "|" + w; }
function c3(w, i) { let s = 0, g = 0; while (i > w) { s += view[w] | 0; w >>>= 1; i++; if (++g > 70) break; } return s + "|" + w; }
function c4(w, p) { let s = 0, g = 0; while (w !== 0) { s += view[p++]; w >>>= 1; if (++g > 70) break; } return s + "|" + p; }
function c5(w) { let s = "", g = 0; while (w > 0) { s = w % 10 + s; w >>= 1; if (++g > 70) break; } return s; }
for (let turn = 0; turn < 3; turn++) {
  for (const v of [-1, 0, 1, 7, 255, -2147483648, 2147483647, 123456789, -7, 4294967295, 2.5, NaN]) {
    console.log(v, ...[a1, a2, a3, a4, a5, a6, a7, a8, a9, b1, b2, c5].map(f => f(v)));
    for (const k of [0, 3, 60, -2]) console.log(v, k, c1(v | 0, k & 63), c1(v >>> 0, 0), c2(v | 0, k), c2(v & 63, k), c3(v | 0, k), c4(v | 0, k & 31), c4(v >>> 0, k & 31));
  }
}
