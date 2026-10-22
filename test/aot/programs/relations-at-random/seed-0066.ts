// Made by test/aot/generate-relations-at-random.ts, seed 66: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  try {
    p0.a = null;
    if (p0.n % 37 === 21) throw p0;
  } finally {
    p0.a = p0;
  }
  const l0 = [p0, p0];
  l0[1].a = p0;
  const g1 = (v: Obj): Obj | null => {
    v.b = null;
    if (p0.n % 53 === 10) slot = v;
    return v;
  };
  if (p0.n % 89 === 1) throw p0;
  bag.set(p0.n % 5, p0);
  let r2: Obj | null = null;
  try {
    r2 = h2(p0, p0, p0, f0, d);
  } catch (e) {
    r2 = e as Obj;
  }
  return null;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const o3: Obj = { tag: "s2." + p0.n, n: p0.n + 8, a: p1, b: null };
  if (p0.n % 31 === 16) slot = p1;
  const r4 = h5({ tag: "s3." + p1.n, n: p1.n + 5, a: p1, b: null }, d);
  return p0;
}
function h2(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const w5: Obj = { tag: "s5." + p0.n, n: p0.n + 4, a: p0, b: null };
  w5.a!.a = p0;
  const r6 = h4(p1, f0, d);
  const t7 = slot;
  const r8 = h4(p1, (v: Obj): Obj | null => {
    p2.b = null;
    if (p1.n % 31 === 24) kept.push(p1);
    return v;
  }, d);
  const g9 = (v: Obj): Obj | null => {
    p1.b = v;
    p0.b = p0;
    v.a = v;
    return p0;
  };
  const r10 = h4(p1, f0, d);
  try {
    if (p2 === p1) p2.n += 1000;
    if (p0.n % 71 === 20) throw p0;
  } finally {
    if (p2.n % 53 === 7) kept.push(p0);
  }
  if (r8 !== null) {
    if (p1 === p2) p1.n += 1000;
  }
  return r8;
}
function h3(p0: Obj, d: number): Obj | null {
  const r11 = h4(p0, (v: Obj): Obj | null => {
    p0.a = null;
    return v;
  }, d);
  for (const v of both(p0, p0)) {
    v.a = v;
  }
  const l12 = [p0, p0];
  l12[1].a = p0;
  let c13 = p0;
  for (let k = 0; k < 3; k++) c13 = c13.b ?? p0;
  return r11;
}
function h4(p0: Obj, f0: Fn, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  let r14: Obj | null = null;
  try {
    r14 = h5({ tag: "s11." + p0.n, n: p0.n + 7, a: p0, b: null }, d);
  } catch (e) {
    r14 = e as Obj;
  }
  bag.set(p0.n % 5, p0);
  return p0;
}
function h5(p0: Obj, d: number): Obj | null {
  const c15 = p0.n % 2 === 0 ? p0 : p0;
  const g16 = first.bind(null, p0);
  const c17 = c15.n % 2 === 0 ? c15 : p0;
  c15.b = c15;
  const { b: t18 } = p0;
  const o19: Obj = { tag: "s13." + c15.n, n: c15.n + 4, a: null, b: null };
  return c17;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r20 = h2(o1, o0, new Made("c15." + o2.n, o2.n + 1, null), (v: Obj): Obj | null => {
      if (o1.n % 53 === 13) slot = v;
      o1.b = null;
      o0.a = o1;
      return o0;
    }, 1);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 71 === 8) kept.push(r20);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r21 = h1(o0, o1, new Made("c17." + o0.n, o0.n + 9, o1), 2);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 53 === 6) kept.push(r21);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r22 = h4({ tag: "s18." + o1.n, n: o1.n + 4, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o0.n % 37 === 5) slot = o2;
      o0.b = null;
      return v;
    }, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 31 === 10) kept.push(r22);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r23 = h4(o0, (v: Obj): Obj | null => {
      v.a = null;
      if (o1 === v) o1.n += 1000;
      o0.a = v;
      return v;
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 31 === 14) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h2(o1, o2, o2, (v: Obj): Obj | null => {
      o0.n += 2;
      o0.b = o1;
      return o2;
    }, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 31 === 1) kept.push(r24);
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
