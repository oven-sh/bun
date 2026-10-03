import { heapStats } from "bun:jsc";
function count() {
  Bun.gc(true);
  const s = heapStats();
  return [s.objectCount, s.heapSize, s.objectTypeCounts.Process ?? 0];
}
const a = count();
const b = count();
console.log("control: objects", b[0] - a[0], "heapSize", b[1] - a[1], "Process cells before/after", a[2], b[2]);
