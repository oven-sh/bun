// STATISTIC: ViewSumNests >= 3
// Nests add up products of elements of views, a column after the other: the sums of several columns are calculated side by side. Every number of columns and terms, NaN, infinities, stores among what is read, places that go round or leave the view.
"use strict";
const bits = new DataView(new ArrayBuffer(8));
const hash = list => { let h = 3; for (let i = 0; i < list.length; i++) { bits.setFloat64(0, list[i] === list[i] ? list[i] : 0.5); h = Math.imul(h, 33) ^ bits.getInt32(0) ^ bits.getInt32(4); } return (h >>> 0).toString(36); };
function product(out, a, b, h, w, n) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0; for (let k = 0; k < n; k++) sum += a[y * n + k] * b[k * w + x]; out[y * w + x] = sum; } return out; }
function offsets(out, a, b, w, n, from) { for (let x = 0; x < w; x++) { let sum = out[x]; for (let k = 0; k < n; k++) sum += a[from + k] * b[k * w + x + from]; out[x] = sum; } return out; }
function less(out, a, w, n) { for (let x = 0; x < w; x++) { let sum = 1; for (let k = 0; k < n; k++) sum -= a[k * w + x] * a[k]; out[x] = sum; } return out; }
function singles(out, a, b, w, n) { for (let x = 0; x < w; x++) { let sum = 0; for (let k = 0; k < n; k++) sum = sum + a[k] * b[k * w + x]; out[x] = sum * 0.5; } return out; }
const made = (n, Kind, f) => Kind.from({ length: n }, (_, i) => (f ? f(i) : ((i * 7) % 13) * 0.75 - 4));
for (const Kind of [Float64Array, Float32Array]) for (const [h, w, n] of [[0, 3, 2], [1, 1, 1], [2, 1, 3], [1, 2, 5], [2, 3, 4], [3, 4, 4], [2, 5, 3], [1, 7, 6], [2, 8, 2], [1, 9, 9], [3, 16, 5], [1, 4, 0]]) {
  const a = made(h * n + 20, Kind), b = made(n * w + 20, Kind, i => i / 3 - 2), out = [hash(product(new Kind(h * w), a, b, h, w, n)), hash(product(new Float64Array(h * w), a, b, h, w, n)), hash(product(new Float32Array(h * w), b, a, h, w, n)), hash(offsets(made(w, Kind), a, b, w, n, 0)), hash(offsets(made(w, Kind), a, b, w, n, 3)), hash(less(new Kind(w), b, w, n)), hash(singles(new Kind(w), a, b, w, n))];
  console.log(Kind.name, h, w, n, out.join(" "));
  // What is stored lies among what is read, the views are one, the places leave the view.
  const shared = made(60, Kind); console.log(hash(product(shared.subarray(0, h * w), shared, shared.subarray(4), h, w, n)), hash(less(shared, shared, w, n)), hash(singles(shared.subarray(2), shared, shared.subarray(1), w, n)), hash(offsets(shared, shared, shared, w, n, 50)), hash(shared));
}
for (const odd of [NaN, Infinity, -Infinity, -0, 1e308, 5e-324]) { const a = made(12, Float64Array, i => (i === 4 ? odd : i)), b = made(12, Float64Array, i => (i === 7 ? -odd : 1 - i)); console.log(String(odd), Array.from(product(new Float64Array(9), a, b, 3, 3, 3), String).join(), Array.from(less(new Float64Array(4), a, 4, 3), v => (Object.is(v, -0) ? "-0" : String(v))).join()); }
for (const [a, b] of [[[1, 2, 3, 4], [5, 6, 7, 8]], [Int32Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)], [Float64Array.of(1, 2), ["3", "4"]], [[1.5], new Float32Array(1)]]) console.log(Array.from(product(new Float64Array(4), a, b, 2, 2, 2), String).join(), Array.from(singles([], a, b, 2, 2), String).join()); const gone = made(16, Float64Array); structuredClone(gone.buffer, { transfer: [gone.buffer] }); console.log(hash(product(new Float64Array(4), gone, made(8, Float64Array), 2, 2, 2)), hash(less(gone, made(8, Float64Array), 2, 2)), gone.length);
