// Rows that are read and rows that are stored lie in one buffer, one over the other by no, one or several elements, in front or behind: each turn sees what the turns in front of it stored.
const bits = new DataView(new ArrayBuffer(8));
const hash = list => { let h = 17; for (let i = 0; i < list.length; i++) { const v = list[i]; if (typeof v !== "number") { h = Math.imul(h, 31) + String(v).length | 0; continue; } if (v !== v) { h = Math.imul(h, 31) + 3 | 0; continue; } bits.setFloat64(0, v); h = Math.imul(h ^ bits.getInt32(0), 0x01000193) ^ bits.getInt32(4); } return h >>> 0; };
function spread(to, from, n, by) { for (let i = 0; i < n; i++) to[i] = from[i] * by + to[i]; return to; }
function carried(list, at, off, n) { for (let i = 0; i < n; i++) list[at + i] = list[at + off + i] * 0.5 + list[at + i] * 0.25; return list; }
function between(to, left, right, n) { for (let i = 0; i < n; i++) to[i] = (left[i] + right[i]) * 0.5; return to; }
function changedPlaces(a, b, n) { for (let i = 0; i < n; i++) { const t = a[i]; a[i] = b[i] + 1; b[i] = t * 2; } return a; }
function tilted(grid, width, height, k) { for (let y = 1; y < height; y++) for (let x = 0; x + 1 < width; x++) grid[y * width + x] = grid[(y - 1) * width + x + 1] * k + grid[y * width + x]; return grid; }
function back(to, from, n) { for (let i = n - 1; i >= 0; i--) to[i] = from[i] - 0.125; return to; }
for (const Kind of [Float64Array, Float32Array, Int32Array, Uint8Array, Int16Array, Uint8ClampedArray]) {
  const made = () => Kind.from({ length: 40 }, (_, i) => i * 3 - (i % 4) * 0.5);
  for (const off of [-9, -2, -1, 0, 1, 2, 3, 8]) {
    const all = made(), at = 12, n = 16, out = [];
    out.push(hash((spread(all.subarray(at, at + n), all.subarray(at + off, at + off + n), n, 0.75), all)));
    const second = made(); out.push(hash(carried(second, at, off, n)));
    const third = made(); out.push(hash((between(third.subarray(at, at + n), third.subarray(at + off, at + off + n), third.subarray(at - off, at - off + n), n), third)));
    const fourth = made(); out.push(hash((changedPlaces(fourth.subarray(at, at + n), fourth.subarray(at + off, at + off + n), n), fourth)));
    const fifth = made(); out.push(hash((back(fifth.subarray(at, at + n), fifth.subarray(at + off, at + off + n), n), fifth)));
    console.log(Kind.name, off, out.join(" "));
  }
  for (const [w, h] of [[4, 10], [5, 8], [1, 9], [39, 1], [3, 13]]) console.log(Kind.name, w, h, hash(tilted(made(), w, h, 0.5)));
}
// Lists that are one list, views of other kinds over one buffer (whole numbers alone), and a buffer that is shared.
const list = Array.from({ length: 30 }, (_, i) => i / 2); console.log(hash(spread(list, list, 30, 0.5)), hash(carried(list, 3, 1, 20)), hash(changedPlaces(list, list, 30)), hash(between(list, list, list, 33)));
const words = new Int32Array(16).map((_, i) => i * 0x01020304), bytes = new Uint8Array(words.buffer, 3, 40); console.log(hash(spread(bytes, words, 12, 1)), hash(words), hash(spread(words, bytes, 12, 2)), hash(bytes));
const shared = new Float64Array(new SharedArrayBuffer(240)); for (let i = 0; i < 30; i++) shared[i] = i; console.log(hash(carried(shared, 4, 1, 20)), hash((spread(shared.subarray(1), shared, 20, 0.5), shared)));
