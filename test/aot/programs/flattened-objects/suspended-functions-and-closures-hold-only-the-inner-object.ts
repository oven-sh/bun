// Arrays of pairs, pairs that hold arrays, closures, suspended functions that hold nothing but the inner object, other threads.
// STATISTIC: FieldsDeferringFlattenedObjects >= 1
import { edenGC, fullGC } from "bun:jsc";

type Inner = { count: number; label: string; list: number[] };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i, list: [i, i + 1, i + 2] }, tag: i });
    }
  }
}
function churn(): number { const some: Outer[] = []; fill(some, 12, 12); return some[5].inner.list[1]; }
function collect(step: number): void { churn(); if (step % 2) edenGC(); else fullGC(); churn(); }
function show(inner: Inner): string { return `${inner.count} ${inner.label} ${inner.list.join("+")}`; }

function inArrays(x: Outer, y: Outer) { const pairs = [x, y, x]; const inners = pairs.map(each => each.inner); collect(8); return inners.map(show).join(" | ") + " | " + (inners[0] === inners[2]) + (inners[0] === x.inner); }
function sorted(some: Outer[]) { const copy = some.slice(0, 6).sort((a, b) => b.inner.count - a.inner.count); collect(9); return copy.map(each => each.inner.count).join(); }
function destructured(x: Outer) { const { inner: { count, list: [first, ...others] }, tag } = x; collect(10); return `${count} ${first} ${others.join("+")} ${tag}`; }
function closureOverInner(x: Outer | null) { const inner = x!.inner; const read = () => show(inner); x = null; collect(11); return read; }
function closureOverOuter(x: Outer) { return () => show(x.inner); }

function* yields(x: Outer | null): Generator<string, string, void> {
  const inner = x!.inner;
  x = null;
  yield show(inner);
  inner.count += 1;
  yield show(inner);
  return show(inner);
}
async function awaits(x: Outer | null): Promise<string> {
  const inner = x!.inner;
  x = null;
  await null;
  collect(12);
  inner.count += 1;
  await new Promise(resolve => setTimeout(resolve, 1));
  collect(13);
  return show(inner);
}
async function awaitsWithOuter(x: Outer): Promise<string> {
  const before = x.inner.count;
  await null;
  collect(14);
  x.inner.count += 1;
  await null;
  return before + " " + show(x.inner);
}

{
  for (let round = 0; round < 3; round++) {
    const o: Outer[] = [];
    fill(o, 8, 8);
    let next = 0;
    console.log(round, "arrays:", inArrays(o[next++], o[next++]));
    console.log(round, "sorted:", sorted(o));
    console.log(round, "destructured:", destructured(o[next++]));
    const overInner = closureOverInner(o[next]); o[next++] = o[0];
    const overOuter = closureOverOuter(o[next]); o[next++] = o[0];
    const generator = yields(o[next]); o[next++] = o[0];
    const first = generator.next().value;
    const waiting = awaits(o[next]); o[next++] = o[0];
    const waitingWithOuter = awaitsWithOuter(o[next]); o[next++] = o[0];
    collect(round);
    collect(round + 1);
    console.log(round, "closures:", overInner(), "|", overOuter());
    console.log(round, "generator:", first, "|", generator.next().value, "|", generator.next().value);
    console.log(round, "async:", await waiting, "|", await waitingWithOuter);
  }
}
