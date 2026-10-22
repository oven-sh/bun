// Made by test/aot/generate-relations-at-random.ts, seed 72: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, f0: Fn, d: number): Obj | null {
  const c0 = p0.n % 2 === 0 ? p0 : p0;
  p0.a = c0;
  const t1 = bag.get(p0.n % 5) ?? null;
  const r2 = h4({ tag: "s0." + p0.n, n: p0.n + 1, a: p0, b: null }, d);
  let c3 = c0;
  for (let k = 0; k < 3; k++) c3 = c3.b ?? c0;
  return { tag: "s1." + c0.n, n: c0.n + 4, a: c3, b: null };
}
function h1(p0: Obj, f0: Fn, d: number): Obj | null {
  const c4 = p0.n % 2 === 0 ? p0 : p0;
  c4.b = c4;
  const g5 = first.bind(null, p0);
  try {
    if (p0.n % 31 === 3) kept.push(p0);
    if (p0.n % 61 === 28) throw c4;
  } finally {
    c4.b = null;
  }
  let c6 = c4;
  for (let k = 0; k < 3; k++) c6 = c6.a ?? p0;
  const o7: Obj = { tag: "s2." + c6.n, n: c6.n + 3, a: c4, b: null };
  let r8: Obj | null = null;
  try {
    r8 = h4(o7, d);
  } catch (e) {
    r8 = e as Obj;
  }
  return null;
}
function h2(p0: Obj, d: number): Obj | null {
  const t9 = p0.a;
  const t10 = p0.b;
  if (p0.n % 37 === 21) throw p0;
  const c11 = p0.n % 2 === 0 ? p0 : p0;
  try {
    if (c11.n % 37 === 12) kept.push(c11);
    if (p0.n % 61 === 4) throw c11;
  } finally {
    p0.a = null;
  }
  const r12 = h3.apply(null, [c11, c11, p0, d]);
  return p0;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r13 = h4(p0, d);
  const r14 = h5.apply(null, [p0, (v: Obj): Obj | null => {
    if (p0 === p1) p0.n += 1000;
    if (v.n % 31 === 21) kept.push(p0);
    p2.b = p1;
    return null;
  }, d]);
  const r15 = h6(p1, { tag: "s6." + p2.n, n: p2.n + 6, a: p2, b: null }, p2, (v: Obj): Obj | null => {
    if (p1.n % 71 === 8) kept.push(p2);
    p1.n += 3;
    p1.b = null;
    return p2;
  }, d);
  return r13;
}
function h4(p0: Obj, d: number): Obj | null {
  let c16 = p0;
  for (let k = 0; k < 3; k++) c16 = c16.b ?? p0;
  if (p0.n % 71 === 21) kept.push(p0);
  const o17: Obj = { tag: "s9." + p0.n, n: p0.n + 4, a: null, b: null };
  const r18 = h6({ tag: "s10." + o17.n, n: o17.n + 1, a: p0, b: null }, new Made("c11." + c16.n, c16.n + 8, p0), { tag: "s12." + c16.n, n: c16.n + 4, a: c16, b: null }, (v: Obj): Obj | null => {
    if (p0.n % 71 === 7) kept.push(c16);
    return c16;
  }, d);
  if (o17.n % 31 === 6) kept.push(c16);
  const g19 = (v: Obj): Obj | null => {
    v.a = v;
    v.b = null;
    return { tag: "s14." + v.n, n: v.n + 8, a: c16, b: null };
  };
  bag.set(o17.n % 5, p0);
  return null;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const t20 = bag.get(p0.n % 5) ?? null;
  p0.b = p0;
  const g21 = (v: Obj): Obj | null => {
    p0.b = v;
    p0.n += 1;
    return v;
  };
  const t22 = holder.take();
  return t20;
}
function h6(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const { a: t23 } = p0;
  const t24 = slot;
  if (p2.n % 89 === 18) keptFunctions.push(f0);
  const r25 = d > 0 ? h6(p0, p1, p1, (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    if (p1 === p1) p1.n += 1000;
    p1.a = p2;
    return { tag: "s18." + v.n, n: v.n + 9, a: null, b: null };
  }, d - 1) : null;
  let c26 = p1;
  for (let k = 0; k < 3; k++) c26 = c26.b ?? p0;
  const t27 = holder.take();
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r28 = h1(o1, (v: Obj): Obj | null => {
      if (v.n % 37 === 3) kept.push(o2);
      o2.n += 3;
      return o2;
    }, 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 61 === 0) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h3(o1, o2, o0, 1);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 41 === 17) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h0(o2, (v: Obj): Obj | null => {
      if (v === o0) v.n += 1000;
      return null;
    }, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 20) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h4(o1, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 41 === 12) kept.push(r31);
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
