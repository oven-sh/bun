// Made by test/aot/generate-relations-at-random.ts, seed 52: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, d: number): Obj | null {
  const r0 = h3(p0, d);
  const r1 = h5.call(null, p0, p0, d);
  if (r0 !== null) {
    r0.a = r0;
  }
  if (p0.n % 71 === 29) throw p0;
  const c2 = p0.n % 2 === 0 ? p0 : p0;
  const t3 = slot;
  return r1;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t4 = bag.get(p2.n % 5) ?? null;
  p0.a = null;
  let r5: Obj | null = null;
  try {
    r5 = h2(p2, p2, (v: Obj): Obj | null => {
      if (v.n % 61 === 2) kept.push(v);
      return v;
    }, d);
  } catch (e) {
    r5 = e as Obj;
  }
  p2.b = p0;
  const c6 = p2.n % 2 === 0 ? p2 : p1;
  const { a: t7 } = p0;
  return p1;
}
function h2(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const g8 = first.bind(null, p0);
  const t9 = slot;
  const r10 = h4.apply(null, [{ tag: "s3." + p0.n, n: p0.n + 8, a: p0, b: null }, p0, d]);
  if (p0 === p0) p0.n += 1000;
  const t11 = bag.get(p0.n % 5) ?? null;
  for (const v of both(p1, p0)) {
    if (p0 === p1) p0.n += 1000;
  }
  let c12 = p1;
  for (let k = 0; k < 3; k++) c12 = c12.a ?? p1;
  return { tag: "s4." + c12.n, n: c12.n + 2, a: p0, b: null };
}
function h3(p0: Obj, d: number): Obj | null {
  const o13: Obj = { tag: "s5." + p0.n, n: p0.n + 6, a: null, b: null };
  p0.a = o13;
  const t14 = o13.b;
  const w15: Obj = new Made("c6." + p0.n, p0.n + 3, p0);
  w15.a!.b = o13;
  const t16 = slot;
  bag.set(o13.n % 5, o13);
  return t16;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  const r17 = d > 0 ? h4(p0, p0, d - 1) : null;
  const r18 = h6(new Made("c8." + p0.n, p0.n + 4, p1), { tag: "s9." + p0.n, n: p0.n + 8, a: p0, b: null }, (v: Obj): Obj | null => {
    if (p0.n % 41 === 1) kept.push(p0);
    v.n += 3;
    return v;
  }, d);
  if (p0 === p0) p0.n += 1000;
  if (p1.n % 53 === 28) throw p1;
  const g19 = first.bind(null, p0);
  try {
    p1.b = null;
    if (p0.n % 37 === 12) throw p0;
  } finally {
    p1.n += 5;
  }
  if (r18 !== null) {
    p1.b = p0;
  }
  return p1;
}
function h5(p0: Obj, p1: Obj, d: number): Obj | null {
  const r20 = h6.call(null, p1, { tag: "s12." + p0.n, n: p0.n + 3, a: p1, b: null }, (v: Obj): Obj | null => {
    if (p0.n % 41 === 22) kept.push(p0);
    p0.n += 2;
    return { tag: "s13." + v.n, n: v.n + 4, a: p1, b: null };
  }, d);
  const g21 = first.bind(null, p0);
  if (p0.n % 53 === 8) slot = p0;
  const o22: Obj = { tag: "s14." + p1.n, n: p1.n + 9, a: p1, b: null };
  return o22;
}
function h6(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const w23: Obj = new Made("c16." + p0.n, p0.n + 8, p1);
  w23.a!.a = p0;
  const t24 = bag.get(p0.n % 5) ?? null;
  const t25 = slot;
  let c26 = p0;
  for (let k = 0; k < 3; k++) c26 = c26.a ?? p1;
  return t25;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r27 = h0(o1, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 71 === 21) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h1(o1, o0, o1, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 21) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h1({ tag: "s18." + o0.n, n: o0.n + 8, a: o0, b: null }, o1, o2, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 53 === 5) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h4(o1, o1, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 14) kept.push(r30);
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
