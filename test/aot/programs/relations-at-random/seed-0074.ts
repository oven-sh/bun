// Made by test/aot/generate-relations-at-random.ts, seed 74: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
interface Obj {
  tag: string;
  n: number;
  a: Obj | null;
  b: Obj | null;
}
type Fn = (v: Obj) => Obj | null;
const kept: Obj[] = [];
const keptFunctions: Fn[] = [];
let slot: Obj | null = null;
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
class Made {
  b: Obj | null = null;
  constructor(
    public tag: string,
    public n: number,
    public a: Obj | null,
  ) {}
}
class Holder {
  held: Obj | null = null;
  hold(o: Obj): void {
    this.held = o;
  }
  take(): Obj | null {
    const o = this.held;
    this.held = null;
    return o;
  }
}
const holder = new Holder();
const bag = new Map<number, Obj>();
function* both(x: Obj, y: Obj): Generator<Obj> {
  yield x;
  yield y;
}
function first(x: Obj, y: Obj): Obj | null {
  y.n += 1;
  return x;
}
function spy(tag: string, n: number): Obj {
  let inner: Obj | null = null;
  return {
    tag,
    n,
    b: null,
    get a() {
      if (kept.length < 400) kept.push(this);
      return inner;
    },
    set a(v) {
      if (v !== null && kept.length < 400) kept.push(v);
      inner = v;
    },
  };
}
function h0(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p2.n % 61 === 4) throw p1;
  const t0 = slot;
  const w1: Obj = { tag: "s0." + p0.n, n: p0.n + 3, a: p1, b: null };
  w1.a!.b = p2;
  return p0;
}
function h1(p0: Obj, p1: Obj, d: number): Obj | null {
  p0.b = p0;
  bag.set(p0.n % 5, p1);
  return p0;
}
function h2(p0: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  const g2 = first.bind(null, p0);
  for (const v of both(p0, p0)) {
    if (v.n % 89 === 14) slot = p0;
  }
  const l3 = [p0, p0];
  l3[1].b = p0;
  const g4 = (v: Obj): Obj | null => {
    if (v.n % 53 === 8) kept.push(p0);
    if (v === p0) v.n += 1000;
    if (v.n % 37 === 0) slot = v;
    return p0;
  };
  const t5 = slot;
  return null;
}
function h3(p0: Obj, d: number): Obj | null {
  try {
    if (p0.n % 89 === 1) kept.push(p0);
    if (p0.n % 37 === 16) throw p0;
  } finally {
    p0.n += 3;
  }
  const t6 = slot;
  for (const v of both(p0, p0)) {
    p0.a = v;
  }
  const t7 = holder.take();
  if (t6 !== null) {
    if (p0.n % 31 === 28) kept.push(t6);
  }
  return null;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  p2.n += 4;
  const r8 = d > 0 ? h4(p2, p0, p0, d - 1) : null;
  const r9 = h5.call(null, p2, p2, p2, d);
  holder.hold(p1);
  const r10 = d > 0 ? h4(p1, { tag: "s6." + p2.n, n: p2.n + 5, a: p1, b: null }, p0, d - 1) : null;
  for (const v of both(p0, p1)) {
    p0.b = null;
  }
  return p2;
}
function h5(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1.n % 37 === 0) holder.hold(p0);
  for (const v of both(p1, p2)) {
    p2.n += 3;
  }
  const w11: Obj = { tag: "s8." + p0.n, n: p0.n + 8, a: p1, b: null };
  w11.a!.b = p2;
  for (const v of both(p0, p2)) {
    if (p2.n % 71 === 4) kept.push(p1);
  }
  return p1;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r12 = h4(o0, { tag: "s10." + o1.n, n: o1.n + 3, a: null, b: null }, { tag: "s11." + o1.n, n: o1.n + 4, a: o2, b: null }, 0);
    if (r12 !== null) {
      sum += r12.n;
      if (r12.n % 31 === 15) kept.push(r12);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r13 = h3({ tag: "s12." + o0.n, n: o0.n + 6, a: o2, b: null }, 0);
    if (r13 !== null) {
      sum += r13.n;
      if (r13.n % 53 === 2) kept.push(r13);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r14 = h4(o0, o1, o2, 0);
    if (r14 !== null) {
      sum += r14.n;
      if (r14.n % 31 === 7) kept.push(r14);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r15 = h3(o0, 0);
    if (r15 !== null) {
      sum += r15.n;
      if (r15.n % 71 === 17) kept.push(r15);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r16 = h0(o2, { tag: "s13." + o2.n, n: o2.n + 1, a: o1, b: null }, o1, 1);
    if (r16 !== null) {
      sum += r16.n;
      if (r16.n % 71 === 16) kept.push(r16);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  sum += o0.n + o2.n + (o0.b !== null ? o0.b.n : 0) + (o2.a !== null ? o2.a.n : 0) + (o0 === o2.a ? 1 : 0);
  if (i % 100 === 50) churn(20);
}
console.log(sum, churn(60), kept.length, keptFunctions.length, caught.length);
const probe: Obj = { tag: "probe", n: 3, a: null, b: null };
const roots: (Obj | null)[] = [slot, holder.held, ...bag.values(), ...kept, ...caught, ...keptFunctions.map(f => f(probe)), probe];
const numbers = new Map<Obj, number>();
const queue: Obj[] = [];
const numberOf = (o: Obj | null): string => {
  if (o === null) return "-";
  let number = numbers.get(o);
  if (number === undefined) {
    number = numbers.size;
    numbers.set(o, number);
    queue.push(o);
  }
  return String(number);
};
console.log(roots.map(numberOf).join(" "));
kept.length = 400;
for (let at = 0; at < queue.length && at < 500; at++) {
  const o = queue[at];
  console.log(at + " " + o.tag + " " + o.n + " " + numberOf(o.a) + " " + numberOf(o.b));
}
console.log(numbers.size);
