// Made by test/aot/generate-relations-at-random.ts, seed 26: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  p0.b = null;
  if (p0.n % 71 === 2) holder.hold(p2);
  const c0 = p1.n % 2 === 0 ? p1 : p0;
  let r1: Obj | null = null;
  try {
    r1 = h4(c0, { tag: "s0." + p1.n, n: p1.n + 7, a: null, b: null }, p0, (v: Obj): Obj | null => {
      c0.n += 1;
      return v;
    }, d);
  } catch (e) {
    r1 = e as Obj;
  }
  for (const v of both(p0, p0)) {
    p1.b = c0;
  }
  return p2;
}
function h1(p0: Obj, d: number): Obj | null {
  const t2 = holder.take();
  const t3 = bag.get(p0.n % 5) ?? null;
  const w4: Obj = { tag: "s3." + p0.n, n: p0.n + 6, a: p0, b: null };
  w4.a!.b = p0;
  try {
    if (p0.n % 89 === 25) kept.push(p0);
    if (p0.n % 41 === 18) throw p0;
  } finally {
    p0.n += 2;
  }
  const t5 = holder.take();
  return t2;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const t6 = holder.take();
  const r7 = h7.call(null, { tag: "s5." + p0.n, n: p0.n + 2, a: p1, b: null }, d);
  const g8 = first.bind(null, p1);
  const c9 = p1.n % 2 === 0 ? p1 : p0;
  const t10 = c9.a;
  if (r7 !== null) {
    if (r7 === p0) r7.n += 1000;
  }
  return t6;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const l11 = [p2, p2];
  l11[1].a = p0;
  bag.set(p1.n % 5, p1);
  if (p1.n % 53 === 19) throw p2;
  bag.set(p0.n % 5, p2);
  const g12 = first.bind(null, p1);
  if (p2.n % 31 === 23) keptFunctions.push(g12);
  const o13: Obj = new Made("c7." + p1.n, p1.n + 6, p1);
  return { tag: "s8." + o13.n, n: o13.n + 1, a: p1, b: null };
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const w14: Obj = { tag: "s9." + p0.n, n: p0.n + 1, a: p2, b: null };
  w14.a!.b = p1;
  const o15: Obj = { tag: "s10." + p0.n, n: p0.n + 2, a: p2, b: null };
  const r16 = h7({ tag: "s11." + p0.n, n: p0.n + 6, a: p1, b: null }, d);
  const r17 = f0(p2);
  const l18 = [p0, p0];
  l18[1].b = p0;
  if (p0.n % 89 === 6) kept.push(o15);
  if (o15 === o15) o15.n += 1000;
  return p2;
}
function h5(p0: Obj, d: number): Obj | null {
  const o19: Obj = new Made("c13." + p0.n, p0.n + 8, p0);
  const l20 = [o19, p0];
  l20[0].b = p0;
  const w21: Obj = { tag: "s14." + o19.n, n: o19.n + 1, a: o19, b: null };
  w21.a!.a = p0;
  const r22 = h6.apply(null, [new Made("c15." + o19.n, o19.n + 6, o19), p0, o19, d]);
  const t23 = o19.b;
  try {
    o19.b = p0;
    if (o19.n % 71 === 20) throw o19;
  } finally {
    if (o19.n % 41 === 14) slot = p0;
  }
  return null;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  let c24 = p2;
  for (let k = 0; k < 3; k++) c24 = c24.a ?? p1;
  if (p2.n % 61 === 12) kept.push(p1);
  const r25 = h7.apply(null, [p1, d]);
  const t26 = holder.take();
  const l27 = [p1, p1];
  l27[0].b = p2;
  const t28 = p0.a;
  const o29: Obj = { tag: "s17." + p1.n, n: p1.n + 6, a: null, b: null };
  return t26;
}
function h7(p0: Obj, d: number): Obj | null {
  const t30 = p0.a;
  try {
    p0.n += 2;
    if (p0.n % 41 === 12) throw p0;
  } finally {
    p0.b = p0;
  }
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r31 = h4({ tag: "s20." + o2.n, n: o2.n + 9, a: null, b: null }, { tag: "s21." + o1.n, n: o1.n + 6, a: null, b: null }, o0, (v: Obj): Obj | null => {
      v.a = o0;
      o0.a = null;
      return o0;
    }, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 12) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h1(o2, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 53 === 18) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h0(o1, new Made("c23." + o0.n, o0.n + 8, o0), o1, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 31 === 10) kept.push(r33);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r34 = h5(o1, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 61 === 6) kept.push(r34);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r35 = h2(o0, o0, 0);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 89 === 11) kept.push(r35);
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
