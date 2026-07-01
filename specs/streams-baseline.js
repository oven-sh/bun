import { heapStats } from "bun:jsc";
function delta(fn, n) {
  Bun.gc(true); Bun.gc(true);
  const before = heapStats();
  const keep = new Array(n);
  for (let i = 0; i < n; i++) keep[i] = fn(i);
  Bun.gc(true); Bun.gc(true);
  const after = heapStats();
  const d = {};
  const keys = new Set([...Object.keys(before.objectTypeCounts), ...Object.keys(after.objectTypeCounts)]);
  for (const k of keys) {
    const v = (after.objectTypeCounts[k] || 0) - (before.objectTypeCounts[k] || 0);
    if (v > n * 0.5) d[k] = +(v / n).toFixed(2);
  }
  const objsPer = (after.objectCount - before.objectCount) / n;
  const bytesPer = (after.heapSize - before.heapSize) / n;
  keep.length = 0;
  return { objsPer: +objsPer.toFixed(1), heapBytesPer: Math.round(bytesPer), perStream: d };
}
const N = 20000;
console.log("== new ReadableStream({start,pull,cancel}) ==\n" + JSON.stringify(delta(() => new ReadableStream({start(){},pull(){},cancel(){}}), N)));
console.log("== new ReadableStream() + getReader() ==\n" + JSON.stringify(delta(() => { const s = new ReadableStream(); return [s, s.getReader()]; }, N)));
console.log("== new WritableStream({write(){}}) ==\n" + JSON.stringify(delta(() => new WritableStream({write(){}}), N)));
console.log("== new TransformStream() ==\n" + JSON.stringify(delta(() => new TransformStream(), N)));
console.log("== new Response('x').body ==\n" + JSON.stringify(delta(() => new Response("x").body, N)));
