// Weak references, weak maps, weak sets and registries that name the inner object, or the outer one, of a pair.
// STATISTIC: FieldsDeferringFlattenedObjects >= 1
import { fullGC } from "bun:jsc";

type Inner = { count: number; label: string };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i }, tag: i });
    }
  }
}
function churn(): number { const some: Outer[] = []; fill(some, 20, 20); return some[7].inner.count; }

const weakInner: WeakRef<Inner>[] = [];
const weakOuter: WeakRef<Outer>[] = [];
const byInner = new WeakMap<Inner, string>();
const byOuter = new WeakMap<Outer, Inner>();
const setOfInner = new WeakSet<Inner>();
let cleanedInner = 0, cleanedOuter = 0;
const registryOfInner = new FinalizationRegistry<number>(() => { cleanedInner++; });
const registryOfOuter = new FinalizationRegistry<number>(() => { cleanedOuter++; });

function watchInner(outer: Outer): void { weakInner.push(new WeakRef(outer.inner)); }
function watchOuter(outer: Outer): void { weakOuter.push(new WeakRef(outer)); }
function mapInner(outer: Outer): void { byInner.set(outer.inner, "mapped" + outer.tag); }
function mapOuter(outer: Outer): void { byOuter.set(outer, outer.inner); }
function addInner(outer: Outer): void { setOfInner.add(outer.inner); }
function registerBoth(outer: Outer): void { registryOfInner.register(outer.inner, outer.tag); registryOfOuter.register(outer, outer.tag); }

const kept: Outer[] = [];
const keptInner: Inner[] = [];
async function round(): Promise<void> {
  const outers: Outer[] = [];
  fill(outers, 10, 10);
  for (let i = 0; i < 10; i++) { watchInner(outers[i]); watchOuter(outers[i]); }
  for (let i = 10; i < 20; i++) { mapInner(outers[i]); mapOuter(outers[i]); addInner(outers[i]); }
  for (let i = 20; i < 30; i++) registerBoth(outers[i]);
  // Of each ten: the outer object of the first three is kept, of the next three only the inner one, the rest nothing.
  for (const start of [0, 10, 20]) {
    for (let i = 0; i < 3; i++) kept.push(outers[start + i]);
    keptInner.push(outers[start + 3].inner, outers[start + 4].inner, outers[start + 5].inner);
  }
}
await round();
for (let i = 0; i < 4; i++) { await new Promise(resolve => setTimeout(resolve, 1)); churn(); fullGC(); }

// While the outer object lives, so does the inner one, and it is the same one.
console.log(weakInner.slice(0, 3).map((ref, i) => ref.deref() === kept[i].inner).join(), weakOuter.slice(0, 3).map((ref, i) => ref.deref() === kept[i]).join());
console.log(weakInner.slice(3, 6).map((ref, i) => ref.deref() === keptInner[i]).join());
console.log(kept.slice(3, 6).map(outer => byInner.get(outer.inner) + " " + (byOuter.get(outer) === outer.inner) + " " + setOfInner.has(outer.inner)).join(" | "));
console.log(keptInner.slice(3, 6).map(inner => byInner.get(inner) + " " + setOfInner.has(inner) + " " + inner.count + inner.label).join(" | "));
console.log(kept.map(outer => outer.inner.count + outer.inner.label).join(), keptInner.map(inner => inner.count + inner.label).join());
console.log("no callback for what is kept:", cleanedInner <= 4, cleanedOuter <= 7);
