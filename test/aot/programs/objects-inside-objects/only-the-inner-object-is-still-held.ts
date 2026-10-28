// An object that lies in another is wanted for itself, and then nothing holds the outer one any more. Many collections later every field of it is what it was, and what it names is alive.
import { edenGC, fullGC } from "bun:jsc";

type Leaf = { id: number };
type Inner = { count: number; label: string; list: number[]; leaf: Leaf | null };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i, list: [i, i + 1], leaf: { id: i } }, tag: i });
    }
  }
}

function churn(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const some: Outer[] = [];
    fill(some, 8, 8);
    sum += some[round % 64].inner.count + some[round % 64].inner.label.length;
  }
  return sum;
}

function show(inner: Inner): string {
  return `${inner.count} ${inner.label} ${inner.list.join()} ${inner.leaf ? inner.leaf.id : "none"}`;
}

function collect(round: number): void {
  if (round % 3 === 0) fullGC();
  else edenGC();
}

const inArray: Inner[] = [];
const inMap = new Map<number, Inner>();
const inSet = new Set<Inner>();
const inClosures: (() => Inner)[] = [];
const inFields: { held: Inner }[] = [];
const inWeakMap = new WeakMap<Leaf, Inner>();
const keysOfWeakMap: Leaf[] = [];

function keepInArray(outer: Outer): void { inArray.push(outer.inner); }
function keepInMap(outer: Outer): void { inMap.set(outer.tag, outer.inner); }
function keepInSet(outer: Outer): void { inSet.add(outer.inner); }
function keepInClosure(outer: Outer): void { const inner = outer.inner; inClosures.push(() => inner); }
function keepInField(outer: Outer): void { inFields.push({ held: outer.inner }); }
function keepInWeakMap(outer: Outer): void { const key = { id: -outer.tag }; keysOfWeakMap.push(key); inWeakMap.set(key, outer.inner); }
function overCalls(outer: Outer | null, round: number): string {
  const inner = outer!.inner;
  outer = null;
  churn(2);
  collect(round);
  churn(2);
  collect(round + 1);
  return show(inner);
}

let total = 0;
const lines: string[] = [];
for (let round = 0; round < 12; round++) {
  let outers: Outer[] | null = [];
  fill(outers, 10, 10);
  keepInArray(outers[round]);
  keepInMap(outers[round + 12]);
  keepInSet(outers[round + 24]);
  keepInClosure(outers[round + 36]);
  keepInField(outers[round + 48]);
  keepInWeakMap(outers[round + 60]);
  const last = outers[round + 72];
  outers = null;
  lines.push(overCalls(last, round));
  total += churn(3);
  collect(round);
  total += churn(3);
  collect(round + 2);
}
fullGC();
total += churn(10);
fullGC();
console.log(total);
console.log(lines.join(" | "));
console.log(inArray.map(show).join(" | "));
console.log([...inMap].map(([key, inner]) => key + ":" + show(inner)).join(" | "));
console.log([...inSet].map(show).join(" | "));
console.log(inClosures.map(read => show(read())).join(" | "));
console.log(inFields.map(each => show(each.held)).join(" | "));
console.log(keysOfWeakMap.map(key => show(inWeakMap.get(key)!)).join(" | "));
