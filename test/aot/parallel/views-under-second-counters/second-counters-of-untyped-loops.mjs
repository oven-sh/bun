// What an untyped loop steps beside its counter enters its specialized version as an integer and stays one there, or becomes what its steps make of it.
function sum(v, n) { let p = 0, s = 0; for (let i = 0; i < n; i++) { s += (v[p] || 0) * 3 + (v[p + 1] || 0); p += 4; } return s + " " + p; }
function fill(v, w, n) { let p = 0; for (let i = 0; i < n; i++) { const x = w[i]; v[p] = x & 255; v[p + 1] = x >> 8 & 255; v[p + 2] = 1; p += 3; } return p; }
function falls(v, n) { let p = n * 4 - 4, s = 0; for (let i = n - 1; i >= 0; i--) { s += (v[p] || 0) * 2; p -= 4; } return s + " " + p; }
function far(v, n, x) { let p = 2147483640, q = 9007199254740980, s = 0; for (let i = 0; i < n; i++) { s += (v[p] || 1) + (p & 7) + (q % 5); p += 3; q += x; } return s + " " + p + " " + q; }
function fractions(v, n, x) { let p = 0, s = 0; for (let i = 0; i < n; i++) { s += v[p] || 0.5; p += x; } return s + " " + p; }
function turns(v, n, at, to) { let p = 0, s = 0; for (let i = 0; i < n; i++) { if (i === at) p = to; s += +v[p] || 7; p++; } return s + " " + p; }
function sometimes(v, n) { let p = 0, q = 0, s = 0; for (let i = 0; i < n; i++) { if (v[p] & 1) { s += v[q] || 2; q++; } else s -= 1; p += 2; } return s + " " + p + " " + q; }
function negativeZero(n) { let p = -0, s = 0; for (let i = 0; i < n; i++) { s += 1 / p === -Infinity ? 1 : 0; p += 0; } return s + " " + Object.is(p, -0); }
const holders = [new Uint8Array(40).map((_, i) => i * 7), new Float64Array(20).map((_, i) => i / 4), Array.from({ length: 30 }, (_, i) => i * 2), [1, 2.5, , "x", null, 6], "abcdefghij0123456789", { 0: 5, 4: 6 }];
for (const v of holders) for (const n of [0, 1, 2, 10, 12]) {
  console.log(n, sum(v, n), falls(v, n), far(v, n, 1), far(v, n, 4), far(v, n, "1"), fractions(v, n, 1), fractions(v, n, 0.5), fractions(v, n, "2"), sometimes(v, n));
  for (const to of [3, -1, 1.5, undefined, null, "4", NaN, 2 ** 31, 2 ** 53]) console.log(turns(v, n, 2, to));
}
for (const v of [new Uint8ClampedArray(30), new Float32Array(29), [], new Array(5)]) console.log(fill(v, new Uint32Array(9).map((_, i) => i * 123457), 9), fill(v, [1.5, "7", undefined, 2 ** 40], 4), Array.from(v).join());
console.log(negativeZero(0), negativeZero(1), negativeZero(5));
