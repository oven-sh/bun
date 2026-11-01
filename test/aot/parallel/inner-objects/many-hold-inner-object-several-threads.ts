// Many objects and promises hold the same inner objects, and nothing else holds the objects those lie in. Several threads mark them at once, and the collector checks each visit.
// Env: BUN_JSC_verifyGC=1
import { fullGC } from "bun:jsc";
type Inner = { count: number; label: string };
type Outer = { inner: Inner; tag: number };
type Holder = { held: Inner; id: number };
function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i }, tag: i });
    }
  }
}
function hold(list: Holder[], outer: Outer, id: number): void { list.push({ held: outer.inner, id }); }
function promise(list: Promise<Inner>[], outer: Outer): void { list.push(Promise.resolve(outer.inner)); }
const holders: Holder[][] = [];
const promises: Promise<Inner>[][] = [];
let outers: Outer[] | null = [];
fill(outers, 40, 50);
for (let part = 0; part < 48; part++) {
  const list: Holder[] = [];
  const settled: Promise<Inner>[] = [];
  for (let i = 0; i < 2000; i++) {
    hold(list, outers[(i * 7 + part) % 2000], i);
    promise(settled, outers[(i * 11 + part) % 2000]);
  }
  holders.push(list);
  promises.push(settled);
}
outers = null;
let sum = 0;
for (let round = 0; round < 300; round++) {
  fullGC();
  sum += holders[round % 48][round].held.count + holders[(round + 20) % 48][round].held.label.length + (await promises[round % 48][round]).count;
}
console.log(sum);
