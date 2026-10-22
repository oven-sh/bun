// Made by test/aot/generate-relations-at-random.ts, seed 20: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0.n % 89 === 27) throw p0;
  const g0 = (v: Obj): Obj | null => {
    p1.b = p0;
    return v;
  };
  const t1 = holder.take();
  const c2 = p1.n % 2 === 0 ? p1 : p1;
  return c2;
}
function h1(p0: Obj, d: number): Obj | null {
  const r3 = h8.call(null, p0, (v: Obj): Obj | null => {
    p0.a = v;
    if (v.n % 53 === 27) slot = v;
    if (v.n % 61 === 27) slot = v;
    return v;
  }, d);
  bag.set(p0.n % 5, p0);
  const g4 = (v: Obj): Obj | null => {
    v.a = null;
    return v;
  };
  const r5 = h3(p0, p0, p0, d);
  if (p0.n % 37 === 16) keptFunctions.push(g4);
  return p0;
}
function h2(p0: Obj, d: number): Obj | null {
  const t6 = holder.take();
  const w7: Obj = new Made("c5." + p0.n, p0.n + 6, p0);
  w7.a!.a = p0;
  const t8 = slot;
  const { b: t9 } = p0;
  return t8;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t10 = bag.get(p1.n % 5) ?? null;
  const r11 = h4.apply(null, [new Made("c7." + p2.n, p2.n + 3, p1), p2, p2, (v: Obj): Obj | null => {
    p0.n += 3;
    if (p1.n % 71 === 29) slot = p1;
    return new Made("c8." + v.n, v.n + 9, p2);
  }, d]);
  const r12 = h6(p0, p2, (v: Obj): Obj | null => {
    p1.n += 3;
    if (v.n % 71 === 15) slot = p1;
    if (v.n % 89 === 11) kept.push(v);
    return p1;
  }, d);
  const r13 = h7.apply(null, [p1, d]);
  const r14 = h6.apply(null, [p0, new Made("c10." + p1.n, p1.n + 4, p0), (v: Obj): Obj | null => {
    if (p0 === v) p0.n += 1000;
    v.b = p2;
    if (p0 === p0) p0.n += 1000;
    return p1;
  }, d]);
  return r14;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r15 = f0(p1);
  const g16 = first.bind(null, p1);
  const g17 = first.bind(null, p0);
  const t18 = bag.get(p1.n % 5) ?? null;
  p0.b = null;
  const g19 = (v: Obj): Obj | null => {
    p1.b = p1;
    return v;
  };
  return r15;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const r20 = d > 0 ? h5(p0, f0, d - 1) : null;
  const o21: Obj = new Made("c15." + p0.n, p0.n + 3, p0);
  const r22 = h8.apply(null, [o21, (v: Obj): Obj | null => {
    o21.b = null;
    v.n += 4;
    return v;
  }, d]);
  if (r20 !== null) {
    o21.b = null;
  }
  const l23 = [o21, o21];
  l23[1].a = p0;
  const r24 = h7(new Made("c17." + o21.n, o21.n + 8, p0), d);
  if (o21 === p0) o21.n += 1000;
  const r25 = d > 0 ? h5(p0, (v: Obj): Obj | null => {
    p0.a = null;
    v.b = p0;
    return null;
  }, d - 1) : null;
  return o21;
}
function h6(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  p0.a = null;
  if (p0.n % 37 === 0) kept.push(p0);
  p1.a = p1;
  const g26 = first.bind(null, p0);
  const t27 = bag.get(p1.n % 5) ?? null;
  for (const v of both(p1, p0)) {
    p1.b = v;
  }
  return { tag: "s20." + p1.n, n: p1.n + 4, a: p0, b: null };
}
function h7(p0: Obj, d: number): Obj | null {
  const g28 = (v: Obj): Obj | null => {
    if (v.n % 37 === 17) slot = p0;
    if (p0.n % 41 === 14) kept.push(p0);
    return p0;
  };
  const t29 = p0.a;
  const r30 = h8(p0, (v: Obj): Obj | null => {
    v.b = v;
    if (v === v) v.n += 1000;
    v.n += 5;
    return { tag: "s22." + v.n, n: v.n + 7, a: null, b: null };
  }, d);
  const l31 = [p0, p0];
  l31[1].b = p0;
  return p0;
}
function h8(p0: Obj, f0: Fn, d: number): Obj | null {
  if (p0 === p0) p0.n += 1000;
  try {
    if (p0.n % 53 === 7) kept.push(p0);
    if (p0.n % 89 === 26) throw p0;
  } finally {
    p0.a = p0;
  }
  try {
    p0.a = p0;
    if (p0.n % 71 === 22) throw p0;
  } finally {
    p0.b = null;
  }
  const t32 = holder.take();
  try {
    p0.n += 5;
    if (p0.n % 41 === 6) throw p0;
  } finally {
    p0.a = p0;
  }
  const c33 = p0.n % 2 === 0 ? p0 : p0;
  if (c33.n % 37 === 1) keptFunctions.push(f0);
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r34 = h8(o0, (v: Obj): Obj | null => {
      if (o2.n % 37 === 16) slot = o0;
      return o0;
    }, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 71 === 26) kept.push(r34);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r35 = h6(o1, { tag: "s26." + o1.n, n: o1.n + 5, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o0.n % 31 === 26) slot = o1;
      return o1;
    }, 0);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 61 === 11) kept.push(r35);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r36 = h4(o1, o2, { tag: "s28." + o1.n, n: o1.n + 3, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o0.n % 53 === 24) slot = o1;
      o2.a = null;
      return v;
    }, 0);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 53 === 12) kept.push(r36);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r37 = h5(new Made("c30." + o0.n, o0.n + 1, o0), (v: Obj): Obj | null => {
      if (o1.n % 61 === 6) kept.push(o0);
      return new Made("c31." + v.n, v.n + 8, v);
    }, 2);
    if (r37 !== null) {
      sum += r37.n;
      if (r37.n % 53 === 26) kept.push(r37);
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
