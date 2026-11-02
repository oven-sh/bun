// The inner object is made first, with the cell of both; a text is split before the outer object is filled, and that collects: the outer object has a header and none of its booleans yet.
// Its cell lies where other objects lay before, so a slot that is not written yet holds what they left there.
// Env: BUN_JSC_validateAOTRuntime=1
// Env: BUN_JSC_slowPathAllocsBetweenGCs=10
// Env: BUN_JSC_useConcurrentGC=0
import { fullGC } from "bun:jsc";

interface Inner { count: number; text: string }
interface Outer { seen?: boolean; inner: Inner; rest?: unknown; done?: boolean; parts: string[] }
interface Label { order: number; name: string }
interface Tagged { label: Label; low: number; high: number }

const labels: (Label | null)[] = new Array(1024).fill(null);
const tagged: (Tagged | null)[] = new Array(1024).fill(null);
function makeTagged(i: number, x: number): Tagged {
  const label: Label = { order: i, name: "s" + i };
  labels[i & 1023] = label;
  return { label, low: x, high: x };
}
function fillCellsAndLetGo(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const made = makeTagged(i, 0x55555555 ^ (i & 1));
    tagged[i & 1023] = made;
    sum += made.low & 1;
  }
  labels.fill(null);
  tagged.fill(null);
  return sum;
}

const inners: Inner[] = [];
function make(i: number, text: string): Outer {
  const inner: Inner = { count: i, text: "t" + i };
  inners.push(inner);
  const parts = text.split(/,/);
  return { inner, parts };
}

const outers: Outer[] = [];
let sum = 0;
for (let round = 0; round < 4; round++) {
  sum += fillCellsAndLetGo(4000);
  fullGC();
  for (let i = 0; i < 1500; i++) {
    const made = make(i, "a,b,c," + i);
    if (i % 7 === 0) made.seen = i % 2 === 0;
    if (i % 5 === 0) made.done = i % 3 === 0;
    if (i % 11 === 0) made.rest = i;
    outers.push(made);
  }
}
for (const outer of outers) {
  sum += outer.inner.count + outer.parts.length;
  sum += outer.seen === undefined ? 1 : outer.seen ? 2 : 3;
  sum += outer.done === undefined ? 1 : outer.done ? 2 : 3;
  sum += outer.rest === undefined ? 0 : 1;
}
console.log(sum, inners.length);
