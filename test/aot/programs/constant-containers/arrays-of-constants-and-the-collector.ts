import { heapStats } from "bun:jsc";
function numbers(): number[] { return [1, 2, 3, 4, 5]; }
function fractions(): number[] { return [0.5, 1.5, 2.5]; }
function long(): number[] { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]; }
function nested(): number[][] { return [[1, 2], [3, 4], [5, 6]]; }
function table(): { id: number; at: number[]; more: { w: number[] } }[] {
  return [{ id: 1, at: [1, 2], more: { w: [0.5] } }, { id: 2, at: [3, 4], more: { w: [1.5] } }, { id: 3, at: [5, 6], more: { w: [2.5] } }, { id: 4, at: [7, 8], more: { w: [3.5] } }, { id: 5, at: [9, 10], more: { w: [4.5] } }, { id: 6, at: [11, 12], more: { w: [5.5] } }];
}
const kept: any[] = [];
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 20000; i++) {
    const a = numbers(), b = fractions(), c = long(), d = nested(), e = table();
    if (i % 1000 === 0) kept.push(a, b, c, d, e);
    if (i % 1500 === 0) { a[0] = i; b.push(i); c.length = 3; d[1][0] = i; e[2].at.push(i); e[3].more.w[0] = i; kept.push({ a, b, c, d, e }); }
  }
  Bun.gc(true);
}
for (let i = 0; i < kept.length; i += 7) { const k = kept[i]; if (Array.isArray(k) && typeof k[0] === "number") k[0] = -1; }
Bun.gc(true);
let text = JSON.stringify(kept); let hash = 0; for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
console.log(kept.length, text.length, hash, JSON.stringify([numbers(), fractions(), nested(), table()[2]]));
const snapshot = Bun.generateHeapSnapshot(); console.log(typeof snapshot, heapStats().objectCount > 0);
const weak = new WeakRef(numbers()); const registry = new WeakMap<object, number>(); const key = long(); registry.set(key, 1); Bun.gc(true); console.log(registry.get(key), weak.deref() === undefined || weak.deref()!.join() === "1,2,3,4,5");
