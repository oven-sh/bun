const A = process.argv.slice(2), s = Number(A[0] ?? 0), args0 = (A[1] ?? "1") === "1";
class Top { constructor(key, tag) { this.key = key; this.tag = tag; } }
class Heap { top = null; size = 0; constructor(key, tag) { this.top = new Top(key, tag); this.size = 1; } }
const H1 = new Heap(s & 2 ? 1 : 9, 11), H2 = new Heap(s & 4 ? 3 : 7, 22);
const largest = (s & 1) !== 0;
const k1 = s & 2 ? 1 : 9, k2 = s & 4 ? 3 : 7; const want = (largest ? k1 > k2 : k1 < k2) ? 11 : 22;
function step(h1, h2, largest) {
  if (h1.size <= 0 || h2.size <= 0 || h1.top === null || h2.top === null) return -1;
  const first = largest ? h1.top.key > h2.top.key : h1.top.key < h2.top.key;
  const h = first ? h1 : h2, n = first ? h1.size : h2.size;
  if (n > 0 && h.top !== null) return h.top.tag;
  return -2;
}
const got = step(H1, H2, largest);
console.log(got === want ? "ok" : "wrong");
