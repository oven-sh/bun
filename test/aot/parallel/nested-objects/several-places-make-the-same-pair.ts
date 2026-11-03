// Several functions make objects of one and the same pair of layouts, and each row does something else with the inner object. Some of the functions are called, some taken into their callers.

const N = 20_000;
const alive: unknown[] = [];
function collect() { Bun.gc(true); return 0; }
function report(name: string, sum: number, before: number, kind: string) {
  console.log(name + ":", sum, kind, before + collect());
}

type P1 = { a: { b: number } };
function make1(i: number): P1 { return { a: { b: i } }; }
function use1(x: P1) { return x.a.b; }
{
  const kept = new Array<ReturnType<typeof make1>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make1(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use1(kept[i]);
  report("read through", sum, before, typeof kept[sum % N]);
}

type P2 = { a: { b: number } };
function make2(i: number): P2 { return { a: { b: i } }; }
function use2(x: P2) { const c = x.a; return c.b + c.b; }
{
  const kept = new Array<ReturnType<typeof make2>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make2(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use2(kept[i]);
  report("held by a local name", sum, before, typeof kept[sum % N]);
}

type C3 = { b: number };
type P3 = { a: C3 };
function make3(i: number): P3 { return { a: { b: i } }; }
function read3(c: C3) { return c.b; }
function use3(x: P3) { return read3(x.a); }
{
  const kept = new Array<ReturnType<typeof make3>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make3(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use3(kept[i]);
  report("passed to a function that reads", sum, before, typeof kept[sum % N]);
}

type C4 = { b: number };
type P4 = { a: C4 };
const others: C4[] = [];
function make4(i: number): P4 { return { a: { b: i } }; }
function use4(x: P4) { if ((x.a.b & 65535) === 0) others.push(x.a); return x.a.b; }
{
  const kept = new Array<ReturnType<typeof make4>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make4(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use4(kept[i]);
  report("kept now and then", sum, before, typeof kept[sum % N]);
}

class C5 { b: number; constructor(i: number) { this.b = i; } }
class P5 { a: C5; constructor(i: number) { this.a = new C5(i); } }
function make5(i: number) { return new P5(i); }
function use5(x: P5) { return x.a.b; }
{
  const kept = new Array<ReturnType<typeof make5>>(N);
  alive.push(kept);
  const before = collect();
  for (let i = 0; i < N; i++) kept[i] = make5(i);
  let sum = 0;
  for (let i = 0; i < N; i++) sum += use5(kept[i]);
  report("made by constructors", sum, before, typeof kept[sum % N]);
}

type C6 = { b: number };
type P6 = { a: C6; n: number };
function make6(i: number): P6 { return { a: { b: 0 }, n: i }; }
function use6(x: P6) { x.a = { b: x.n }; return x.n; }
function read6(x: P6) { return x.a.b; }
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
console.log(alive.length, others.length, others.every((c, i) => c.b === i * 65536), JSON.stringify((alive[3] as P4[])[0]), (alive[3] as P4[])[0].a === others[0]);
