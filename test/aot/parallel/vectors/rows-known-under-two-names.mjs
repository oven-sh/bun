// What a nest stores under one name it reads under another: the names are of one list, of views over one buffer, or of lists that have nothing to do with one another.
const hash = list => { let h = 5; for (let i = 0; i < list.length; i++) h = Math.imul(h, 31) + (Number.isFinite(+list[i]) ? Math.round(list[i] * 64) : 9) | 0; return h >>> 0; };
function kept(to, from, width, height) { for (let y = 0; y < height; y++) { const first = from[y * width]; for (let x = 0; x < width; x++) to[y * width + x] = from[y * width + x] + first * 0.5; } return to; }
function reread(to, from, n) { let sum = 0; for (let i = 0; i + 1 < n; i++) { const before = from[i + 1]; to[i + 1] = before * 2 - sum; sum += from[i + 1] - before; } return sum; }
function thirds(a, b, c, n) { for (let i = 0; i < n; i++) { a[i] = b[i] + 1; c[i] = b[i] * a[i]; } return a; }
function corners(to, from, width, height, place) { const corner = from[place]; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) to[y * width + x] = to[y * width + x] * corner + from[place]; return corner; }
const list = n => Array.from({ length: n }, (_, i) => i * 0.5 - 2), view = n => Float64Array.from({ length: n }, (_, i) => i * 0.5 - 2);
for (const make of [list, view, n => Float32Array.from(view(n)), n => Int32Array.from(list(n))]) {
  for (const [w, h] of [[4, 5], [3, 2], [1, 7], [6, 1]]) {
    const n = w * h, out = [];
    { const a = make(n); out.push(hash(kept(a, a, w, h)), hash(a)); }
    { const a = make(n), b = make(n); out.push(hash(kept(a, b, w, h)), hash(b)); }
    { const a = make(n); out.push(reread(a, a, n), hash(a)); } { const a = make(n), b = make(n); out.push(reread(a, b, n), hash(a)); }
    { const a = make(n); out.push(hash(thirds(a, a, a, n))); } { const a = make(n), b = make(n); thirds(a, b, b, n); out.push(hash(a), hash(b)); }
    { const a = make(n); out.push(corners(a, a, w, h, n >> 1), hash(a)); } { const a = make(n), b = make(n); out.push(corners(a, b, w, h, 0), hash(a)); }
    const wide = make(n + 4); if (wide.subarray) { const one = wide.subarray(0, n), other = wide.subarray(2, n + 2); kept(one, other, w, h); reread(other, one, n); corners(one, other, w, h, 1); thirds(other, one, wide.subarray(3), n); out.push(hash(wide)); }
    console.log(make(1).constructor.name, w, h, out.map(v => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)).join(" "));
  }
}
const words = new Int32Array(12).map((_, i) => i * 65537), halves = new Int16Array(words.buffer); kept(halves, words, 3, 4); thirds(words, halves, halves, 12); console.log(hash(words), hash(halves));
for (let k = 0; k < 60; k++) { const a = list(12); kept(a, k & 1 ? a : list(12), 3, 4); reread(a, a, 12); corners(a, list(12), 4, 3, k % 12); }
