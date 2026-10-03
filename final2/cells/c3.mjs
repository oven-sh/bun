import { heapStats } from "bun:jsc";
function count() {
  Bun.gc(true);
  const s = heapStats();
  return [s.objectCount, s.heapSize];
}
const f = () => {};
const p = globalThis.process;
const a = count();
p.on("x", f);
const b = count();
p.on("SIGINT", f);
const c = count();
p.off("x", f);
p.off("SIGINT", f);
const d = count();
console.log("first on: objects", b[0] - a[0], "heapSize", b[1] - a[1], "| signal on:", c[0] - b[0], c[1] - b[1], "| after both off:", d[0] - a[0], d[1] - a[1]);
