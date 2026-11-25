// Elements of lists and views under a counter and a constant, above and below it, read and stored into, also the same element twice.
// STATISTIC: ConstantsFoldedIntoElementAddresses >= 20
const n = JSON.parse("3") as number, log: string[] = [];
function neighbors(a: number[], c: number[]): number { let s = 0; for (let i = 1; i < a.length - 1; i++) { c[i] = a[i - 1] * 2 + a[i] + a[i + 1] * 3; s += c[i]; } return s; }
function further(a: number[]): number { let s = 0; for (let i = 2; i < a.length - 2; i++) s += a[i - 2] - a[i + 2] * a[i + 1] + a[i - 1]; return s; }
function inPlace(c: number[]): number { for (let i = 0; i < c.length - 1; i++) c[i] = c[i + 1] - c[i]; return c[0]; }
function matrices(p: number[], q: number[], t: number[]): number { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += p[r + 4 * k] * q[k + 4 * c]; t[r + 4 * c] = s; } return t[5]; }
function swaps(c: number[]): number { let s = 0; for (let i = 0; i < c.length - 1; i++) if (c[i] > c[i + 1]) { const t = c[i]; c[i] = c[i + 1]; c[i + 1] = t; s++; } return s; }
function ofFloats(a: Float64Array, c: Float64Array): number { for (let i = 1; i < a.length - 1; i++) c[i] = a[i - 1] + a[i] * 2 + a[i + 1]; return c[2]; }
function ofFloat32s(a: Float32Array): number { let s = 0; for (let i = 0; i + 3 < a.length; i++) s += a[i] + a[i + 1] + a[i + 2] + a[i + 3]; return s; }
function ofInt32s(a: Int32Array): number { let s = 0; for (let i = 0; i + 1 < a.length; i++) { a[i + 1] = (a[i + 1] + a[i]) | 0; s ^= a[i + 1]; } return s; }
function ofInt16s(a: Int16Array): number { let s = 0; for (let i = 0; i + 2 < a.length; i += 2) s += a[i] * a[i + 1] - a[i + 2]; return s; }
function ofBytes(a: Uint8Array): number { let s = 0; for (let i = 0; i + 3 < a.length; i += 4) s = (s * 31 + (a[i] | a[i + 1] << 8 | a[i + 2] << 16 | a[i + 3] << 24)) | 0; return s; }
function ofClampedBytes(a: Uint8ClampedArray): number { for (let i = 1; i < a.length - 1; i++) a[i] = (a[i - 1] + a[i + 1]) * 0.75; return a[4]; }
function window(a: Float64Array): number { let s = 0; for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[(y + dy) * 8 + x + dx] * (dx + 2 * dy + 1); return s; }
function fromFour(a: number[]): number { let s = 0; for (let i = 4; i < 12; i++) s += a[i - 4] * a[i - 1] + a[i + 4]; return s; }
const texts = (list: ArrayLike<number>) => Array.from(list, value => (Object.is(value, -0) ? "-0" : String(value))).join();
const lists: (() => any[])[] = [() => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5], () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], () => Array.from({ length: n + 14 }, (_, i) => 20 - i * 1.25), () => [], () => [n], () => [n, 0.5], () => [3, 2.5, 1], () => [1, , 3.5, 4], () => [2, "3", 1, 4], () => [NaN, -0, 0, Infinity, 1, 2]];
for (let times = 0; times < 3; times++) {
  for (const make of lists) {
    const a = make(), c = make(), same = make();
    log.push([neighbors(a, c), further(a), neighbors(same, same), inPlace(make()), swaps(c), fromFour(a), matrices(a, c, make()), matrices(same, same, same)].join(" ") + " | " + texts(a) + " | " + texts(c) + " | " + texts(same));
    const numbers = make().map(Number), floats = Float64Array.from(numbers), sums = new Float64Array(floats.length), clamped = Uint8ClampedArray.from(numbers), whole = Int32Array.from(numbers);
    log.push([ofFloats(floats, sums), ofFloats(floats, floats), ofFloat32s(Float32Array.from(numbers)), ofInt32s(whole), ofInt16s(Int16Array.from(numbers)), ofBytes(Uint8Array.from(numbers)), ofClampedBytes(clamped), window(Float64Array.from({ length: 64 }, (_, i) => i * n))].join(" ") + " | " + texts(sums) + " | " + texts(floats) + " | " + texts(whole) + " | " + texts(clamped));
  }
}
console.log(log.join("\n"));
