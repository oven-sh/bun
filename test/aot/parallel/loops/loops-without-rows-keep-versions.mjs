// A loop that stores into lists of its own and none of whose rows it stores into keeps its versions: out[count++] = ids[i], STACK[sp++] = left.
// STATISTIC: LargeLoopsOfElementsVersioned >= 5
const STACK = new Uint32Array(96);
class Index {
  constructor(n, nodeSize = 64, ArrayType = Float64Array) {
    this.n = +n; this.nodeSize = Math.min(Math.max(+nodeSize, 2), 65535); this.ArrayType = ArrayType; this.IdType = n < 65536 ? Uint16Array : Uint32Array;
    const data = this.data = new ArrayBuffer(16 + n * 2 * ArrayType.BYTES_PER_ELEMENT + n * 4);
    this.coords = new ArrayType(data, 16, n * 2); this.ids = new this.IdType(data, 16 + n * 2 * ArrayType.BYTES_PER_ELEMENT, n);
    this.pos = 0;
  }
  add(x, y) { const index = this.pos >> 1; this.ids[index] = index; this.coords[this.pos++] = x; this.coords[this.pos++] = y; return index; }
  withinInto(qx, qy, r, out) {
    const { ids, coords, nodeSize } = this;
    STACK[0] = 0; STACK[1] = ids.length - 1; STACK[2] = 0;
    let sp = 3, count = 0; const r2 = r * r;
    while (sp > 0) {
      const axis = STACK[--sp], right = STACK[--sp], left = STACK[--sp];
      if (right - left <= nodeSize) {
        for (let i = left; i <= right; i++) { if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r2) out[count++] = ids[i]; }
        continue;
      }
      const m = (left + right) >> 1, x = coords[2 * m], y = coords[2 * m + 1];
      if (sqDist(x, y, qx, qy) <= r2) out[count++] = ids[m];
      if (axis === 0 ? qx - r <= x : qy - r <= y) { STACK[sp++] = left; STACK[sp++] = m - 1; STACK[sp++] = 1 - axis; }
      if (axis === 0 ? qx + r >= x : qy + r >= y) { STACK[sp++] = m + 1; STACK[sp++] = right; STACK[sp++] = 1 - axis; }
    }
    return count;
  }
}
function sqDist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
const kinds = [Int32Array, Float64Array];
function cluster(data, n, tree, r, stride) {
  const found = new Uint32Array(n); let total = 0;
  for (let i = 0; i < n * stride; i += stride) { if (data[i + 2] > 0) continue; const x = data[i], y = data[i + 1]; total += tree.withinInto(x, y, r, found); for (let k = 0; k < 2; k++) total += found[k]; }
  return total;
}
function work(i) {
  let total = 0;
  for (let k = 0; k < kinds.length - (i % 8 === 0 ? 0 : 1); k++) {
    const n = 30, tree = new Index(n, 64, kinds[k]), data = k ? new Float64Array(n * 3) : [];
    for (let j = 0; j < n; j++) { data[j * 3] = j * 100 + (i & 7); data[j * 3 + 1] = j * 50; data[j * 3 + 2] = 0; tree.add(data[j * 3], data[j * 3 + 1]); }
    total += cluster(data, n, tree, 500, 3);
  }
  return total;
}
let h = 0; const N = Number(process.argv[2] ?? 1);
for (let i = 0; i < N; i++) h = (h * 31 + work(i)) | 0;
console.log(N, h);
