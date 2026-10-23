// The outer objects have survived full collections. Then something young comes to lie in them, or behind their slot: stored through the inner object, laid in with a fresh inner object, or the inner object itself when it is made.
// A collection of the young alone follows, and look-alikes overwrite whatever it has missed.
// STATISTIC: FieldsDeferringFlattenedObjects >= 1
import { edenGC, fullGC } from "bun:jsc";

interface Leaf { v: number; w: number }
interface Inner { r: Leaf; t: Leaf | null; n: number }
interface Outer { a: Inner; id: number }
const N = 24000;
const kept: Outer[] = [];
const trash: unknown[] = new Array(512);
function make(i: number): Outer { return { a: { r: { v: i, w: -i }, t: null, n: i }, id: i }; }
function churn(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const leaf: Leaf = { v: -1, w: -1 };
    const inner: Inner = { r: leaf, t: null, n: -1 };
    trash[i & 511] = i & 1 ? leaf : inner;
    sum += inner.n;
  }
  return sum;
}
function collectTheYoung() { edenGC(); churn(120000); edenGC(); churn(120000); }
function wrong(add: number): number {
  let count = 0;
  for (let i = 0; i < kept.length; i++) {
    const x = kept[i];
    if (x.a.r.v !== x.id + add || x.a.n !== x.id + add) count++;
    if (x.a.t === null || x.a.t.v !== x.id + add) count++;
  }
  return count;
}
function storeThroughTheInnerObject(add: number) { for (let i = 0; i < kept.length; i++) { const x = kept[i]; x.a.t = { v: x.id + add, w: 0 }; x.a.r = { v: x.id + add, w: 1 }; x.a.n = x.id + add; } }
function layFreshOnesIn(add: number) { for (let i = 0; i < kept.length; i++) { const x = kept[i]; x.a = { r: { v: x.id + add, w: 2 }, t: { v: x.id + add, w: 3 }, n: x.id + add }; } }
// Object.keys wants the object, and lets go of it at once: from then on only the slot of the old outer object names it.
function makeThem(): number { let count = 0; for (let i = 0; i < kept.length; i++) count += Object.keys(kept[i].a).length; return count; }

for (let part = 0; part < 4; part++) for (let half = 0; half < 2; half++) for (let i = 0; i < N / 8; i++) kept.push(make(kept.length));
fullGC(); fullGC();
storeThroughTheInnerObject(1);
collectTheYoung();
console.log("stored through the inner object", wrong(1));
fullGC(); fullGC();
layFreshOnesIn(2);
collectTheYoung();
console.log("fresh ones laid in", wrong(2));
fullGC(); fullGC();
console.log("made", makeThem());
collectTheYoung();
console.log("made", wrong(2));
fullGC(); fullGC();
storeThroughTheInnerObject(3);
collectTheYoung();
console.log("stored through the object that was made", wrong(3));
layFreshOnesIn(4);
fullGC();
console.log("laid in again", wrong(4), kept.length);
