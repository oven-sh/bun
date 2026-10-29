// An object that lives in the frame of its function takes its header from the record of its allocation site, which is empty at the first run.
// Whatever fills the record may leave nothing behind that a collection could take for an object with fields.
// Env: BUN_JSC_validateAOTRuntime=1
// Env: BUN_JSC_scribbleFreeCells=1
type Leaf = { label: string; next: Leaf | null; list: number[] };
type Two = { a: Leaf; b: Leaf };
type Four = { a: Leaf; b: Leaf; c: string; d: number[] };
type Six = { a: Leaf; b: Leaf; c: string; d: number[]; e: Leaf | null; f: string };
type Nine = { a: Leaf; b: Leaf; c: string; d: number[]; e: Leaf | null; f: string; g: Leaf; h: number[]; i: string };

// The same sizes under other names: no object of the four types above is ever made in the heap, so the records of their sites are empty until the functions below run.
type HeapTwo = { p: Leaf; q: Leaf };
type HeapFour = { p: Leaf; q: Leaf; r: string; s: number[] };
type HeapSix = { p: Leaf; q: Leaf; r: string; s: number[]; t: Leaf | null; u: string };
type HeapThree = { p: Leaf; r: string; s: number[] };
type HeapSeven = { p: Leaf; r: string; s: number[]; t: Leaf | null; v: Leaf; u: string; w: number[] };
type HeapNine = { p: Leaf; q: Leaf; r: string; s: number[]; t: Leaf | null; u: string; v: Leaf; w: number[]; x: string };

const kept: unknown[] = [];
function leaf(step: number): Leaf {
  return { label: "leaf" + step, next: null, list: [step, step + 1] };
}
// Most of them die: the cells that they leave are what the next allocation of that size gets.
function fillAndEmptyTheHeap(): void {
  for (let step = 0; step < 4000; step++) {
    const p = leaf(step);
    const q = leaf(-step);
    const two: HeapTwo = { p, q };
    const four: HeapFour = { p, q, r: "r" + step, s: [step] };
    const six: HeapSix = { p, q, r: "r" + step, s: [step], t: p, u: "u" + step };
    const nine: HeapNine = { p, q, r: "r" + step, s: [step], t: q, u: "u" + step, v: p, w: [step, step], x: "x" + step };
    const three: HeapThree = { p, r: "r" + step, s: [step] };
    const seven: HeapSeven = { p, r: "r" + step, s: [step], t: q, v: p, u: "u" + step, w: [step] };
    if (step % 500 === 0) kept.push(two, three, four, six, seven, nine);
    else kept[kept.length - 1 - (step % 6)] = step % 2 ? two : step % 3 ? four : step % 5 ? six : step % 7 ? nine : step % 11 ? three : seven;
  }
  Bun.gc(true);
}

// Two objects that are told apart by their identity have to exist, and neither outlives the call.
function either<T>(x: T, y: T, first: boolean): T {
  return first ? x : y;
}
function two(a: Leaf, b: Leaf, collects: boolean): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: Two = { a, b };
    const y: Two = { a: b, b: a };
    if (collects) Bun.gc(true);
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.a.label.length;
    if (y.b === a) sum += y.a.list.length;
  }
  return sum;
}
function four(a: Leaf, b: Leaf, c: string, d: number[], collects: boolean): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: Four = { a, b, c, d };
    const y: Four = { a: b, b: a, c: c + i, d };
    if (collects) Bun.gc(true);
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.a.label.length + x.c.length;
    if (y.b === a) sum += y.d.length + y.c.length;
  }
  return sum;
}
function six(a: Leaf, b: Leaf, c: string, d: number[], collects: boolean): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: Six = { a, b, c, d, e: null, f: c + i };
    const y: Six = { a: b, b: a, c, d, e: a, f: c };
    if (collects) Bun.gc(true);
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.a.label.length + x.f.length + (x.e ? 1 : 0);
    if (y.e === a) sum += y.d.length + y.f.length;
  }
  return sum;
}
function nine(a: Leaf, b: Leaf, c: string, d: number[], collects: boolean): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: Nine = { a, b, c, d, e: a, f: c + i, g: b, h: d, i: c };
    const y: Nine = { a: b, b: a, c, d, e: null, f: c, g: a, h: d, i: c + i };
    if (collects) Bun.gc(true);
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.g.label.length + x.f.length + x.h.length;
    if (y.g === a) sum += y.i.length + (y.e ? 1 : 0);
  }
  return sum;
}

// These two run for the first time at the very end, with no collection behind them: what a check of the whole heap at the exit finds is what they left.
type LastThree = { k: Leaf; l: string; m: number[] };
type LastSeven = { k: Leaf; l: string; m: number[]; n: Leaf | null; o: Leaf; p: string; q: number[] };
function lastThree(k: Leaf, l: string, m: number[]): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: LastThree = { k, l, m };
    const y: LastThree = { k, l: l + i, m };
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.k.label.length + x.l.length;
    if (y.m === m) sum += y.l.length;
  }
  return sum;
}
function lastSeven(k: Leaf, l: string, m: number[]): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x: LastSeven = { k, l, m, n: null, o: k, p: l + i, q: m };
    const y: LastSeven = { k, l: l + i, m, n: k, o: k, p: l, q: m };
    if (either(x, y, i % 2 === 0) === (i % 2 === 0 ? x : y)) sum += x.o.label.length + x.p.length + (x.n ? 1 : 0);
    if (y.q === m) sum += y.l.length + (y.n ? 1 : 0);
  }
  return sum;
}

fillAndEmptyTheHeap();
const first = leaf(1);
const second = leaf(22);
let sum = 0;
for (let round = 0; round < 4; round++) {
  const collects = round % 2 === 0;
  sum += two(first, second, collects);
  sum += four(first, second, "four", [1, 2, 3, 4], collects);
  sum += six(first, second, "six", [1, 2, 3, 4, 5, 6], collects);
  sum += nine(first, second, "nine", [1, 2, 3, 4, 5, 6, 7, 8, 9], collects);
  fillAndEmptyTheHeap();
}
fillAndEmptyTheHeap();
sum += lastThree(first, "three", [1, 2, 3]) + lastSeven(second, "seven", [1, 2, 3, 4, 5, 6, 7]);
console.log(sum, kept.length);
