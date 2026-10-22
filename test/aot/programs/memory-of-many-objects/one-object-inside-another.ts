// One object inside another, 200,000 times, kept alive: the pair is one cell of 32 bytes, however the inner object is read, and though somebody keeps one now and then. In plain Bun it is two cells, 64 bytes.
import { heapStats } from "bun:jsc";

const N = 200_000;
const alive: unknown[] = [];
function collect() { Bun.gc(true); Bun.gc(true); return heapStats(); }
function report(name: string, sum: number, before: { objectCount: number; heapSize: number }, kind: string) {
  const after = collect();
  console.log(name + ":", sum, kind, "one cell a pair:", (after.objectCount - before.objectCount) / N < 1.05, "at most 32 bytes a pair:", (after.heapSize - before.heapSize) / N < 33);
}

type P1 = { a1: { b1: number } };
function make1(i: number): P1 { return { a1: { b1: i } }; }
function use1(x: P1) { return x.a1.b1; }
{
  const kept = new Array<ReturnType<typeof make1>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make1(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use1(kept[i]);
  report("read through", sum, before, typeof kept[sum % N]);
}

type P2 = { a2: { b2: number } };
function make2(i: number): P2 { return { a2: { b2: i } }; }
function use2(x: P2) { const c = x.a2; return c.b2 + c.b2; }
{
  const kept = new Array<ReturnType<typeof make2>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make2(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use2(kept[i]);
  report("held by a local name", sum, before, typeof kept[sum % N]);
}

type C3 = { b3: number };
type P3 = { a3: C3 };
function make3(i: number): P3 { return { a3: { b3: i } }; }
function read3(c: C3) { return c.b3; }
function use3(x: P3) { return read3(x.a3); }
{
  const kept = new Array<ReturnType<typeof make3>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make3(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use3(kept[i]);
  report("passed to a function that reads", sum, before, typeof kept[sum % N]);
}

type C4 = { b4: number };
type P4 = { a4: C4 };
const others: C4[] = [];
function make4(i: number): P4 { return { a4: { b4: i } }; }
function use4(x: P4) { if ((x.a4.b4 & 65535) === 0) others.push(x.a4); return x.a4.b4; }
{
  const kept = new Array<ReturnType<typeof make4>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make4(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use4(kept[i]);
  report("kept now and then", sum, before, typeof kept[sum % N]);
}

class C5 { b5: number; constructor(i: number) { this.b5 = i; } }
class P5 { a5: C5; constructor(i: number) { this.a5 = new C5(i); } }
function make5(i: number) { return new P5(i); }
function use5(x: P5) { return x.a5.b5; }
{
  const kept = new Array<ReturnType<typeof make5>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make5(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use5(kept[i]);
  report("made by constructors", sum, before, typeof kept[sum % N]);
}

type C6 = { b6: number };
type P6 = { a6: C6; n: number };
function make6(i: number): P6 { return { a6: { b6: 0 }, n: i }; }
function use6(x: P6) { x.a6 = { b6: x.n }; return x.n; }
function read6(x: P6) { return x.a6.b6; }
{
  const kept = new Array<ReturnType<typeof make6>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make6(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use6(kept[i]);
  for (let i = 0; i < N; i++) sum += read6(kept[i]);
  report("stored again", sum, before, typeof kept[sum % N]);
}
console.log(alive.length);
