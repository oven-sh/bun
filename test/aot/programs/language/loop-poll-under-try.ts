// Loops poll for interruption inside try, around try, outside try and in functions that call nothing. A getter runs the collector in the middle of each loop: objects the loop still uses survive, and objects dropped before the loops are collected.
const shell = globalThis as any;
const collect: () => void = shell.Bun ? () => shell.Bun.gc(true) : () => shell.fullGC();

const iterations = 240_000;
const allocationInterval = 1_000;
const collectionInterval = 40_000;

interface Link {
  id: number;
  label: string;
  next: Link | null;
}

interface Outcome {
  sum: number;
  head: Link | null;
  first: Link;
}

class CollectingGetter {
  collections = 0;
  constructor(public limit: number) {}
  get collectionCount(): number {
    if (this.collections === this.limit) throw new RangeError("collected " + this.limit + " times");
    collect();
    return ++this.collections;
  }
}

function createLink(id: number, next: Link | null): Link {
  return { id, label: "link" + id, next };
}

function sumInsideTry(collector: CollectingGetter): Outcome {
  const first = createLink(-1, null);
  let head: Link | null = null;
  let sum = 0;
  try {
    for (let i = 0; i < iterations; i++) {
      sum += i & 7;
      if (i % allocationInterval === 0) head = createLink(i, head);
      if (i % collectionInterval === 0) sum += collector.collectionCount;
    }
  } catch {
    sum = -sum;
  }
  return { sum, head, first };
}

function sumAroundTry(collector: CollectingGetter): Outcome {
  const first = createLink(-1, null);
  let head: Link | null = null;
  let sum = 0;
  for (let start = 0; start < iterations; start += collectionInterval) {
    try {
      for (let i = start; i < start + collectionInterval; i++) {
        sum += i & 7;
        if (i % allocationInterval === 0) head = createLink(i, head);
      }
      sum += collector.collectionCount;
    } catch {
      sum = -sum;
    }
  }
  return { sum, head, first };
}

function sumOutsideTry(collector: CollectingGetter): Outcome {
  const first = createLink(-1, null);
  let head: Link | null = null;
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += i & 7;
    if (i % allocationInterval === 0) head = createLink(i, head);
    if (i % collectionInterval === 0) sum += collector.collectionCount;
  }
  return { sum, head, first };
}

function sumWithInlineAllocation(collector: CollectingGetter): Outcome {
  const first: Link = { id: -1, label: "link-1", next: null };
  let head: Link | null = null;
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += i & 7;
    if (i % allocationInterval === 0) head = { id: i, label: "link" + i, next: head };
    if (i % collectionInterval === 0) sum += collector.collectionCount;
  }
  return { sum, head, first };
}

function sumInRegisters(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + (i ^ (sum >>> 3))) | 0;
  return sum;
}

function report(name: string, outcome: Outcome): void {
  let count = 0;
  let isIntact = outcome.first.id === -1 && outcome.first.label === "link-1" && outcome.first.next === null;
  for (let link = outcome.head; link !== null; link = link.next) {
    count++;
    if (link.label !== "link" + link.id) isIntact = false;
    if (link.next === null ? link.id !== 0 : link.next.id !== link.id - allocationInterval) isIntact = false;
  }
  console.log(name + ":", outcome.sum, count, isIntact ? "intact" : "damaged");
}

const dropped: WeakRef<Link>[] = [];
function dropLinks(count: number): void {
  for (let i = 0; i < count; i++) dropped.push(new WeakRef(createLink(i, null)));
}

dropLinks(64);
// A WeakRef keeps its target alive until the job that created it ends.
await new Promise<void>(resolve => setTimeout(resolve, 0));

report("inside try", sumInsideTry(new CollectingGetter(Infinity)));
report("inside try, the getter throws", sumInsideTry(new CollectingGetter(3)));
report("around try", sumAroundTry(new CollectingGetter(Infinity)));
report("around try, the getter throws", sumAroundTry(new CollectingGetter(3)));
report("outside try", sumOutsideTry(new CollectingGetter(Infinity)));
try {
  sumOutsideTry(new CollectingGetter(2));
} catch (error) {
  console.log("outside try, the getter throws:", (error as Error).message);
}
report("inline allocation", sumWithInlineAllocation(new CollectingGetter(Infinity)));
console.log("in registers:", sumInRegisters(iterations));

let alive = 0;
for (const reference of dropped) if (reference.deref() !== undefined) alive++;
console.log("dropped before the loops:", alive * 4 <= dropped.length ? "collected" : alive + " of " + dropped.length + " alive");
export {};
