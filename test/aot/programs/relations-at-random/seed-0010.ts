// Made by test/aot/generate-relations-at-random.ts, seed 10: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  let r0: Obj | null = null;
  try {
    r0 = h5(p1, (v: Obj): Obj | null => {
      p1.n += 1;
      return p1;
    }, d);
  } catch (e) {
    r0 = e as Obj;
  }
  const r1 = h6(p1, p2, d);
  const r2 = h2.apply(null, [p2, { tag: "s1." + p1.n, n: p1.n + 1, a: null, b: null }, (v: Obj): Obj | null => {
    if (p2.n % 53 === 11) slot = p2;
    p1.a = v;
    p0.a = null;
    return p2;
  }, d]);
  const r3 = h3(p2, (v: Obj): Obj | null => {
    if (p0.n % 71 === 26) kept.push(p0);
    if (v.n % 37 === 8) kept.push(v);
    return v;
  }, d);
  if (p0.n % 71 === 0) throw p1;
  const t4 = holder.take();
  return r1;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r5 = h3.call(null, p1, (v: Obj): Obj | null => {
    if (p1.n % 61 === 13) kept.push(p1);
    if (p2.n % 89 === 17) slot = p1;
    return v;
  }, d);
  const t6 = holder.take();
  const g7 = (v: Obj): Obj | null => {
    p0.b = p1;
    if (v.n % 37 === 11) kept.push(v);
    return p1;
  };
  for (const v of both(p1, p0)) {
    if (v.n % 37 === 25) kept.push(p0);
  }
  return p0;
}
function h2(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const t8 = slot;
  const r9 = d > 0 ? h2(p0, p1, f0, d - 1) : null;
  const w10: Obj = { tag: "s8." + p1.n, n: p1.n + 5, a: p0, b: null };
  w10.a!.b = p0;
  let r11: Obj | null = null;
  try {
    r11 = h7(p0, { tag: "s9." + p0.n, n: p0.n + 8, a: p1, b: null }, { tag: "s10." + p1.n, n: p1.n + 3, a: null, b: null }, (v: Obj): Obj | null => {
      if (p0.n % 71 === 14) slot = p1;
      p0.n += 4;
      return null;
    }, d);
  } catch (e) {
    r11 = e as Obj;
  }
  try {
    if (p1 === p1) p1.n += 1000;
    if (p1.n % 53 === 11) throw p1;
  } finally {
    p1.a = p0;
  }
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.a ?? p0;
  const w13: Obj = { tag: "s12." + p0.n, n: p0.n + 9, a: p1, b: null };
  w13.a!.a = p1;
  return r11;
}
function h3(p0: Obj, f0: Fn, d: number): Obj | null {
  const r14 = h5.apply(null, [p0, f0, d]);
  const r15 = f0(p0);
  const r16 = h5.apply(null, [{ tag: "s14." + p0.n, n: p0.n + 4, a: null, b: null }, f0, d]);
  return null;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  for (const v of both(p1, p0)) {
    if (v.n % 53 === 17) slot = v;
  }
  const r17 = h6.call(null, p2, p2, d);
  const t18 = slot;
  const w19: Obj = new Made("c16." + p1.n, p1.n + 1, p2);
  w19.a!.b = p1;
  return p0;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const t20 = bag.get(p0.n % 5) ?? null;
  const r21 = h6({ tag: "s18." + p0.n, n: p0.n + 7, a: null, b: null }, new Made("c19." + p0.n, p0.n + 3, null), d);
  let r22: Obj | null = null;
  try {
    r22 = h7(p0, new Made("c20." + p0.n, p0.n + 3, p0), p0, (v: Obj): Obj | null => {
      if (v.n % 71 === 15) kept.push(v);
      v.b = null;
      return v;
    }, d);
  } catch (e) {
    r22 = e as Obj;
  }
  return new Made("c22." + p0.n, p0.n + 8, p0);
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const t23 = p1.b;
  const t24 = p1.b;
  return p0;
}
function h7(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r25 = d > 0 ? h7(p2, p2, p1, (v: Obj): Obj | null => {
    p0.n += 5;
    if (p2.n % 37 === 18) slot = p2;
    return v;
  }, d - 1) : null;
  try {
    if (p0.n % 53 === 20) kept.push(p0);
    if (p1.n % 61 === 11) throw p2;
  } finally {
    if (p1.n % 53 === 8) kept.push(p2);
  }
  if (p1.n % 61 === 12) slot = p1;
  const t26 = holder.take();
  const r27 = f0(p2);
  const t28 = p2.b;
  bag.set(p1.n % 5, p2);
  for (const v of both(p1, p2)) {
    p2.a = null;
  }
  return t28;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h7(o1, o2, o1, (v: Obj): Obj | null => {
      o1.a = o2;
      if (o0.n % 41 === 13) kept.push(o2);
      return v;
    }, 1);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 41 === 28) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h2(o0, o0, (v: Obj): Obj | null => {
      if (o0.n % 61 === 13) slot = v;
      o2.a = o1;
      return v;
    }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 0) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h6(o1, o0, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 41 === 4) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h5(o1, (v: Obj): Obj | null => {
      o0.a = v;
      return null;
    }, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 41 === 12) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h3(o0, (v: Obj): Obj | null => {
      o2.b = null;
      return o1;
    }, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 31 === 26) kept.push(r33);
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
