// Made by test/aot/generate-relations-at-random.ts, seed 58: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, d: number): Obj | null {
  const g0 = first.bind(null, p0);
  const g1 = first.bind(null, p1);
  const l2 = [p0, p0];
  l2[1].a = p1;
  const t3 = bag.get(p0.n % 5) ?? null;
  const c4 = p1.n % 2 === 0 ? p1 : p1;
  bag.set(p0.n % 5, p0);
  if (p1.n % 37 === 22) throw p0;
  return p1;
}
function h1(p0: Obj, d: number): Obj | null {
  if (p0.n % 31 === 17) throw p0;
  const l5 = [p0, p0];
  l5[1].a = p0;
  try {
    if (p0.n % 61 === 6) kept.push(p0);
    if (p0.n % 89 === 14) throw p0;
  } finally {
    p0.a = null;
  }
  const t6 = p0.b;
  return null;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const g7 = (v: Obj): Obj | null => {
    if (p0.n % 31 === 25) kept.push(p1);
    v.b = null;
    return p1;
  };
  const t8 = holder.take();
  bag.set(p0.n % 5, p1);
  const r9 = h3(p1, p0, { tag: "s3." + p0.n, n: p0.n + 1, a: null, b: null }, d);
  return p1;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t10 = bag.get(p0.n % 5) ?? null;
  const g11 = first.bind(null, p1);
  bag.set(p0.n % 5, p2);
  for (const v of both(p0, p1)) {
    v.n += 1;
  }
  const r12 = h4.call(null, p2, p0, d);
  const r13 = h4(p1, p2, d);
  return p1;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  const t14 = slot;
  const g15 = first.bind(null, p0);
  const t16 = slot;
  return null;
}
function h5(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  if (p1.n % 71 === 22) keptFunctions.push(f0);
  const r17 = f0(p1);
  const t18 = slot;
  const c19 = p1.n % 2 === 0 ? p1 : p0;
  return { tag: "s7." + p0.n, n: p0.n + 1, a: p2, b: null };
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const w20: Obj = { tag: "s8." + p0.n, n: p0.n + 7, a: p0, b: null };
  w20.a!.b = p0;
  const t21 = p0.b;
  let r22: Obj | null = null;
  try {
    r22 = h7({ tag: "s9." + p0.n, n: p0.n + 8, a: null, b: null }, (v: Obj): Obj | null => {
      p0.b = v;
      if (v.n % 31 === 7) slot = p0;
      if (v === p0) v.n += 1000;
      return p0;
    }, d);
  } catch (e) {
    r22 = e as Obj;
  }
  const t23 = bag.get(p0.n % 5) ?? null;
  if (p0.n % 37 === 22) throw p0;
  return r22;
}
function h7(p0: Obj, f0: Fn, d: number): Obj | null {
  p0.b = p0;
  const t24 = bag.get(p0.n % 5) ?? null;
  const g25 = (v: Obj): Obj | null => {
    v.b = null;
    if (v === p0) v.n += 1000;
    return null;
  };
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h0(o1, o2, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 61 === 18) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h7(o0, (v: Obj): Obj | null => {
      if (o0.n % 37 === 28) slot = o0;
      o0.a = null;
      return o1;
    }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 71 === 5) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h6(o2, (v: Obj): Obj | null => {
      o0.a = v;
      return { tag: "s15." + v.n, n: v.n + 2, a: o1, b: null };
    }, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 61 === 3) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h4(o1, o2, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 31 === 12) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h7(o2, (v: Obj): Obj | null => {
      if (o2.n % 71 === 16) slot = o1;
      return null;
    }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 89 === 16) kept.push(r30);
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
