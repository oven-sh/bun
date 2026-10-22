// Made by test/aot/generate-relations-at-random.ts, seed 42: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  p0.a = p0;
  const { b: t0 } = p1;
  const t1 = slot;
  if (t1 !== null) {
    if (p1 === p0) p1.n += 1000;
  }
  if (p0.n % 53 === 6) holder.hold(p0);
  return null;
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const g2 = first.bind(null, p2);
  const r3 = h2({ tag: "s1." + p1.n, n: p1.n + 9, a: p1, b: null }, { tag: "s2." + p2.n, n: p2.n + 7, a: null, b: null }, g2, d);
  try {
    p1.n += 3;
    if (p2.n % 41 === 17) throw p0;
  } finally {
    if (p0.n % 53 === 25) kept.push(p2);
  }
  const r4 = h5.call(null, p0, { tag: "s3." + p2.n, n: p2.n + 9, a: p1, b: null }, new Made("c4." + p1.n, p1.n + 9, null), d);
  const r5 = d > 0 ? h1(p0, p1, { tag: "s5." + p1.n, n: p1.n + 8, a: null, b: null }, f0, d - 1) : null;
  const t6 = p2.b;
  const r7 = d > 0 ? h1(p1, { tag: "s6." + p0.n, n: p0.n + 3, a: p2, b: null }, p1, f0, d - 1) : null;
  return p1;
}
function h2(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const l8 = [p0, p0];
  l8[0].b = p0;
  const t9 = slot;
  if (p1.n % 41 === 9) kept.push(p0);
  const r10 = h7(p0, p0, d);
  const w11: Obj = { tag: "s8." + p1.n, n: p1.n + 7, a: p0, b: null };
  w11.a!.b = p1;
  const t12 = bag.get(p0.n % 5) ?? null;
  return p1;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  let r13: Obj | null = null;
  try {
    r13 = h6(p0, (v: Obj): Obj | null => {
      v.a = v;
      if (p0 === p1) p0.n += 1000;
      if (v.n % 61 === 25) slot = v;
      return v;
    }, d);
  } catch (e) {
    r13 = e as Obj;
  }
  if (p1.n % 89 === 18) throw p1;
  const r14 = h5({ tag: "s11." + p0.n, n: p0.n + 9, a: p1, b: null }, p0, p0, d);
  if (r13 !== null) {
    if (p1.n % 71 === 23) slot = p1;
  }
  const l15 = [p0, p0];
  l15[0].a = p0;
  return r14;
}
function h4(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const { b: t16 } = p0;
  const l17 = [p0, p1];
  l17[1].a = p1;
  const r18 = d > 0 ? h4(p1, { tag: "s13." + p1.n, n: p1.n + 8, a: null, b: null }, (v: Obj): Obj | null => {
    p1.a = p0;
    if (p0 === p0) p0.n += 1000;
    v.a = null;
    return v;
  }, d - 1) : null;
  const g19 = first.bind(null, p1);
  if (p1.n % 89 === 28) keptFunctions.push(g19);
  const t20 = slot;
  return r18;
}
function h5(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  holder.hold(p2);
  const t21 = bag.get(p1.n % 5) ?? null;
  const t22 = slot;
  const t23 = slot;
  const c24 = p1.n % 2 === 0 ? p1 : p2;
  const r25 = h6(p1, (v: Obj): Obj | null => {
    if (c24.n % 71 === 5) slot = c24;
    return c24;
  }, d);
  return t21;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  if (p0.n % 31 === 5) keptFunctions.push(f0);
  bag.set(p0.n % 5, p0);
  const o26: Obj = { tag: "s18." + p0.n, n: p0.n + 7, a: p0, b: null };
  const c27 = p0.n % 2 === 0 ? p0 : o26;
  const t28 = slot;
  return o26;
}
function h7(p0: Obj, p1: Obj, d: number): Obj | null {
  const w29: Obj = { tag: "s20." + p1.n, n: p1.n + 1, a: p1, b: null };
  w29.a!.b = p1;
  if (p1 === p0) p1.n += 1000;
  return p0;
}
function h8(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const o30: Obj = { tag: "s22." + p1.n, n: p1.n + 8, a: null, b: null };
  const g31 = first.bind(null, o30);
  if (o30.n % 37 === 4) slot = p0;
  p0.n += 4;
  if (p0.n % 61 === 22) kept.push(p0);
  const l32 = [p0, o30];
  l32[0].b = p1;
  const o33: Obj = { tag: "s23." + p0.n, n: p0.n + 2, a: p0, b: null };
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r34 = h8(o0, o2, (v: Obj): Obj | null => {
      o1.n += 1;
      if (v.n % 37 === 15) kept.push(o1);
      return { tag: "s25." + v.n, n: v.n + 1, a: o0, b: null };
    }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 71 === 19) kept.push(r34);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r35 = h7(o1, o1, 0);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 53 === 13) kept.push(r35);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r36 = h5(o0, o0, o2, 0);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 89 === 8) kept.push(r36);
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
