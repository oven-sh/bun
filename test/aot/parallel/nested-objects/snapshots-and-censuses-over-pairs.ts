// Whatever walks the whole heap walks over pairs: heap snapshots of both kinds, statistics by type, the sizes of single objects.
import { edenGC, fullGC, heapStats, memoryUsage, estimateShallowMemoryUsageOf } from "bun:jsc";
import { writeHeapSnapshot, getHeapSnapshot, getHeapStatistics } from "node:v8";

type Inner = { count: number; label: string; list: number[] };
type Outer = { inner: Inner; tag: number };
function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i, list: [i] }, tag: i });
    }
  }
}
const held: Inner[] = [];
function hold(outer: Outer): void { held.push(outer.inner); }

const outers: Outer[] = [];
fill(outers, 40, 40);
for (let i = 0; i < outers.length; i += 100) hold(outers[i]);
fullGC();
const stats = heapStats();
console.log(typeof stats.objectCount, stats.objectCount > 1600, typeof stats.objectTypeCounts);
const snapshot = Bun.generateHeapSnapshot();
console.log(Array.isArray(snapshot.nodes), snapshot.nodes.length > 1000, Array.isArray(snapshot.edges));
const text = Bun.generateHeapSnapshot("v8");
console.log(typeof text, text.length > 10000, JSON.parse(text).snapshot.node_count > 1000);
console.log(typeof getHeapStatistics().used_heap_size, typeof memoryUsage().current);
console.log(estimateShallowMemoryUsageOf(outers[1]) > 0, estimateShallowMemoryUsageOf(outers[0].inner) > 0, estimateShallowMemoryUsageOf(outers[2].inner) > 0);
edenGC();
let sum = 0;
for (const outer of outers) sum += outer.inner.count + outer.inner.label.length + outer.inner.list[0];
for (const inner of held) sum += inner.count;
console.log(sum, Bun.inspect(outers[3]), Bun.inspect(outers[100]));
