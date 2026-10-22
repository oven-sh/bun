// An object or a closure that lies in a frame, or was taken apart into scalars, may hold the only reference to cells of the heap. The collector runs inside the callee, at every depth, young and full: it must find those cells through the frame, and must not take what lies in a frame for a cell.
import { edenGC, fullGC } from "bun:jsc";
interface Leaf {
  n: number;
  text: string;
}
interface Holder {
  leaf: Leaf;
  list: Leaf[];
  inner: { leaf: Leaf };
  read: () => Leaf;
}
function leaf(n: number): Leaf {
  return { n, text: "leaf " + n };
}
function garbage(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += [i, { i }, "g" + i].length;
  return sum;
}
function collect(kind: number): void {
  if (kind % 3 === 0) edenGC();
  else if (kind % 3 === 1) fullGC();
  else garbage(400);
}
function check(l: Leaf, n: number): number {
  return l.n === n && l.text === "leaf " + n ? 1 : 0;
}
function readsAfterCollecting(h: Holder, n: number, kind: number): number {
  collect(kind);
  garbage(50);
  return check(h.leaf, n) + check(h.list[0], n + 1) + check(h.list[1], n + 2) + check(h.inner.leaf, n + 3) + check(h.read(), n + 4);
}
function deeper(h: Holder, n: number, kind: number, depth: number): number {
  const mine = { leaf: leaf(n + 100 + depth) };
  const below = depth === 0 ? readsAfterCollecting(h, n, kind) : deeper(h, n, kind, depth - 1);
  return below + check(mine.leaf, n + 100 + depth);
}
function caller(n: number, kind: number): number {
  const captured = leaf(n + 4);
  const holder: Holder = { leaf: leaf(n), list: [leaf(n + 1), leaf(n + 2)], inner: { leaf: leaf(n + 3) }, read: () => captured };
  return deeper(holder, n, kind, n % 5);
}
let good = 0;
let expected = 0;
for (let i = 0; i < 120; i++) {
  good += caller(i, i);
  expected += 5 + (i % 5) + 1;
}
console.log(good === expected, good);

// The callee writes a new cell into the caller's object, then collects, then the caller reads.
function refill(h: { leaf: Leaf | null }, n: number, kind: number): void {
  h.leaf = leaf(n);
  collect(kind);
}
function refilled(n: number, kind: number): number {
  const h: { leaf: Leaf | null } = { leaf: null };
  refill(h, n, kind);
  garbage(50);
  const first = check(h.leaf!, n);
  refill(h, n + 1, kind + 1);
  return first + check(h.leaf!, n + 1);
}
good = 0;
for (let i = 0; i < 90; i++) good += refilled(i, i);
console.log(good);

// Closures: the variable is written by the callee through the closure, between collections.
function callTwice(set: (l: Leaf) => void, n: number, kind: number): void {
  set(leaf(n));
  collect(kind);
  set(leaf(n + 1));
  collect(kind + 1);
}
function written(n: number, kind: number): number {
  let last: Leaf | null = null;
  const history: Leaf[] = [];
  callTwice(l => {
    last = l;
    history.push(l);
  }, n, kind);
  garbage(50);
  return check(last!, n + 1) + check(history[0], n) + check(history[1], n + 1);
}
good = 0;
for (let i = 0; i < 90; i++) good += written(i, i);
console.log(good);

// Fresh results of fresh results, each holding cells, with collections while they are put together.
function build(n: number, kind: number): { a: { leaf: Leaf }; b: { leaf: Leaf } } {
  const a = { leaf: leaf(n) };
  collect(kind);
  const b = { leaf: leaf(n + 1) };
  collect(kind + 1);
  return { a, b };
}
function usesBuilt(n: number, kind: number): number {
  const built = build(n, kind);
  collect(kind + 2);
  return check(built.a.leaf, n) + check(built.b.leaf, n + 1);
}
good = 0;
for (let i = 0; i < 90; i++) good += usesBuilt(i, i);
console.log(good);

// Strings, ropes, big integers, symbols, numbers that are cells: everything a field can hold.
function mixed(n: number): { rope: string; big: bigint; double: number; symbol: symbol; date: Date; regexp: RegExp } {
  return { rope: "rope " + n + " " + "x".repeat(n % 7), big: BigInt(n) ** 5n, double: n + 0.5, symbol: Symbol("s" + n), date: new Date(n * 1000), regexp: new RegExp("r" + n) };
}
function describeAfterCollecting(m: ReturnType<typeof mixed>, kind: number): string {
  collect(kind);
  garbage(50);
  return [m.rope, m.big, m.double, m.symbol.description, m.date.getTime(), m.regexp.source].join("|");
}
let text = "";
for (let i = 0; i < 60; i++) text = describeAfterCollecting(mixed(i), i);
console.log(text);

// Rest arrays, argument lists and spreads made for a call.
function restAfterCollecting(kind: number, ...leaves: Leaf[]): number {
  collect(kind);
  garbage(50);
  let sum = 0;
  for (let i = 0; i < leaves.length; i++) sum += check(leaves[i], i);
  return sum;
}
good = 0;
for (let i = 0; i < 60; i++) good += restAfterCollecting(i, leaf(0), leaf(1), leaf(2)) + restAfterCollecting(i, ...[leaf(0), leaf(1)]);
console.log(good);

// An exception unwinds frames that hold objects; the handler collects and goes on with its own.
function throwsAfterAllocating(n: number): never {
  const doomed = { leaf: leaf(n) };
  throw new Error("thrown with " + doomed.leaf.text);
}
function catches(n: number, kind: number): number {
  const mine = { leaf: leaf(n) };
  try {
    throwsAfterAllocating(n + 1);
  } catch (error) {
    collect(kind);
    return check(mine.leaf, n) + ((error as Error).message === "thrown with leaf " + (n + 1) ? 1 : 0);
  }
}
good = 0;
for (let i = 0; i < 60; i++) good += catches(i, i);
console.log(good);
