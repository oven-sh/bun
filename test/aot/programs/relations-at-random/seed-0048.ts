// Made by test/aot/generate-relations-at-random.ts, seed 48: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const t0 = bag.get(p0.n % 5) ?? null;
  const o1: Obj = { tag: "s0." + p0.n, n: p0.n + 6, a: p0, b: null };
  let r2: Obj | null = null;
  try {
    r2 = h9(p1, d);
  } catch (e) {
    r2 = e as Obj;
  }
  const c3 = p1.n % 2 === 0 ? p1 : p0;
  return t0;
}
function h1(p0: Obj, d: number): Obj | null {
  if (p0 === p0) p0.n += 1000;
  const g4 = (v: Obj): Obj | null => {
    p0.a = v;
    return v;
  };
  const c5 = p0.n % 2 === 0 ? p0 : p0;
  const t6 = slot;
  const o7: Obj = { tag: "s3." + p0.n, n: p0.n + 6, a: c5, b: null };
  return o7;
}
function h2(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const g8 = first.bind(null, p2);
  const o9: Obj = { tag: "s5." + p2.n, n: p2.n + 6, a: p0, b: null };
  let r10: Obj | null = null;
  try {
    r10 = h8(p1, p0, { tag: "s6." + o9.n, n: o9.n + 9, a: p1, b: null }, g8, d);
  } catch (e) {
    r10 = e as Obj;
  }
  if (p2.n % 89 === 20) kept.push(p1);
  return new Made("c7." + o9.n, o9.n + 9, o9);
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const g11 = (v: Obj): Obj | null => {
    if (p0 === p1) p0.n += 1000;
    return p0;
  };
  const g12 = (v: Obj): Obj | null => {
    if (p1.n % 41 === 16) kept.push(v);
    p0.b = null;
    v.a = null;
    return { tag: "s9." + v.n, n: v.n + 2, a: null, b: null };
  };
  const w13: Obj = { tag: "s10." + p1.n, n: p1.n + 3, a: p1, b: null };
  w13.a!.b = p0;
  const r14 = d > 0 ? h3({ tag: "s11." + p1.n, n: p1.n + 1, a: p1, b: null }, p1, d - 1) : null;
  if (r14 !== null) {
    p1.b = p0;
  }
  const g15 = (v: Obj): Obj | null => {
    v.a = null;
    if (v.n % 61 === 19) slot = p1;
    return p0;
  };
  holder.hold(p1);
  return null;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t16 = bag.get(p0.n % 5) ?? null;
  const g17 = (v: Obj): Obj | null => {
    if (p2.n % 61 === 7) kept.push(p1);
    return new Made("c14." + v.n, v.n + 2, v);
  };
  const t18 = bag.get(p2.n % 5) ?? null;
  for (const v of both(p1, p2)) {
    p2.a = p2;
  }
  const g19 = (v: Obj): Obj | null => {
    v.a = v;
    p2.a = null;
    if (p1 === v) p1.n += 1000;
    return v;
  };
  if (p2.n % 31 === 17) keptFunctions.push(g17);
  if (p1.n % 41 === 9) slot = p1;
  const c20 = p1.n % 2 === 0 ? p1 : p2;
  return null;
}
function h5(p0: Obj, d: number): Obj | null {
  const r21 = h6(p0, { tag: "s17." + p0.n, n: p0.n + 5, a: null, b: null }, d);
  const t22 = bag.get(p0.n % 5) ?? null;
  const g23 = (v: Obj): Obj | null => {
    if (p0.n % 53 === 7) kept.push(p0);
    p0.a = v;
    return v;
  };
  const { b: t24 } = p0;
  const w25: Obj = { tag: "s19." + p0.n, n: p0.n + 1, a: p0, b: null };
  w25.a!.a = p0;
  const r26 = g23(p0);
  return { tag: "s20." + p0.n, n: p0.n + 8, a: p0, b: null };
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const t27 = slot;
  const t28 = slot;
  let c29 = p1;
  for (let k = 0; k < 3; k++) c29 = c29.b ?? p0;
  let r30: Obj | null = null;
  try {
    r30 = h7(p1, d);
  } catch (e) {
    r30 = e as Obj;
  }
  let c31 = c29;
  for (let k = 0; k < 3; k++) c31 = c31.b ?? c29;
  p0.a = p1;
  const t32 = slot;
  if (c31 === c31) c31.n += 1000;
  return c29;
}
function h7(p0: Obj, d: number): Obj | null {
  let r33: Obj | null = null;
  try {
    r33 = h9(p0, d);
  } catch (e) {
    r33 = e as Obj;
  }
  const t34 = slot;
  const t35 = holder.take();
  const r36 = h9.apply(null, [p0, d]);
  const c37 = p0.n % 2 === 0 ? p0 : p0;
  return { tag: "s22." + p0.n, n: p0.n + 2, a: c37, b: null };
}
function h8(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  if (p2.n % 61 === 17) throw p1;
  p1.a = null;
  const r38 = h9.apply(null, [{ tag: "s23." + p1.n, n: p1.n + 9, a: p0, b: null }, d]);
  return p1;
}
function h9(p0: Obj, d: number): Obj | null {
  const g39 = (v: Obj): Obj | null => {
    if (v === v) v.n += 1000;
    if (v.n % 61 === 24) slot = v;
    return v;
  };
  const g40 = first.bind(null, p0);
  try {
    p0.n += 4;
    if (p0.n % 37 === 0) throw p0;
  } finally {
    p0.a = p0;
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
    const r41 = h8(o2, o0, o0, (v: Obj): Obj | null => {
      if (o2.n % 89 === 15) kept.push(o0);
      return o2;
    }, 1);
    if (r41 !== null) {
      sum += r41.n;
      if (r41.n % 53 === 23) kept.push(r41);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r42 = h0(o1, o2, (v: Obj): Obj | null => {
      o0.a = null;
      o2.n += 2;
      o1.a = v;
      return null;
    }, 2);
    if (r42 !== null) {
      sum += r42.n;
      if (r42.n % 53 === 11) kept.push(r42);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r43 = h0(o1, o2, (v: Obj): Obj | null => {
      o1.a = v;
      o1.b = o1;
      v.a = o1;
      return null;
    }, 1);
    if (r43 !== null) {
      sum += r43.n;
      if (r43.n % 41 === 22) kept.push(r43);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r44 = h2(o2, o1, o2, (v: Obj): Obj | null => {
      if (v.n % 61 === 21) slot = o1;
      if (o0.n % 61 === 1) kept.push(o0);
      o2.a = v;
      return null;
    }, 1);
    if (r44 !== null) {
      sum += r44.n;
      if (r44.n % 31 === 8) kept.push(r44);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r45 = h9(o1, 2);
    if (r45 !== null) {
      sum += r45.n;
      if (r45.n % 61 === 3) kept.push(r45);
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
