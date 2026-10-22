// Made by test/aot/generate-relations-at-random.ts, seed 70: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  bag.set(p0.n % 5, p0);
  try {
    p0.n += 5;
    if (p0.n % 37 === 24) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const r0 = h4.call(null, p0, p0, p0, d);
  if (p0.n % 41 === 6) holder.hold(p0);
  return null;
}
function h1(p0: Obj, p1: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  try {
    p0.a = p0;
    if (p0.n % 53 === 20) throw p1;
  } finally {
    if (p0.n % 37 === 20) slot = p1;
  }
  const r1 = h2.apply(null, [{ tag: "s1." + p0.n, n: p0.n + 6, a: null, b: null }, p0, p0, (v: Obj): Obj | null => {
    v.b = p0;
    return { tag: "s2." + v.n, n: v.n + 7, a: p0, b: null };
  }, d]);
  const l2 = [p0, p0];
  l2[1].a = p0;
  return null;
}
function h2(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t3 = bag.get(p1.n % 5) ?? null;
  const w4: Obj = { tag: "s4." + p1.n, n: p1.n + 5, a: p0, b: null };
  w4.a!.b = p1;
  const t5 = bag.get(p0.n % 5) ?? null;
  holder.hold(p2);
  let r6: Obj | null = null;
  try {
    r6 = h5(p2, p1, p2, f0, d);
  } catch (e) {
    r6 = e as Obj;
  }
  return r6;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r7 = h4.apply(null, [p2, p2, p0, d]);
  let r8: Obj | null = null;
  try {
    r8 = h7(p0, p1, p1, (v: Obj): Obj | null => {
      p0.n += 2;
      if (v.n % 41 === 23) slot = p0;
      p2.n += 1;
      return p1;
    }, d);
  } catch (e) {
    r8 = e as Obj;
  }
  p0.a = null;
  bag.set(p1.n % 5, p2);
  if (r7 !== null) {
    if (p0 === r7) p0.n += 1000;
  }
  const t9 = p2.a;
  return r7;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t10 = slot;
  let r11: Obj | null = null;
  try {
    r11 = h6(p2, (v: Obj): Obj | null => {
      p1.a = null;
      return { tag: "s8." + v.n, n: v.n + 4, a: p2, b: null };
    }, d);
  } catch (e) {
    r11 = e as Obj;
  }
  p0.b = p0;
  const r12 = h6.apply(null, [p1, (v: Obj): Obj | null => {
    p2.a = p1;
    p2.b = p1;
    p0.b = p2;
    return v;
  }, d]);
  const t13 = p2.b;
  return r12;
}
function h5(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  p0.a = null;
  for (const v of both(p2, p0)) {
    p1.a = v;
  }
  let r14: Obj | null = null;
  try {
    r14 = h8(p2, p0, f0, d);
  } catch (e) {
    r14 = e as Obj;
  }
  const t15 = bag.get(p0.n % 5) ?? null;
  const r16 = h7(p2, p0, new Made("c11." + p0.n, p0.n + 6, null), (v: Obj): Obj | null => {
    p0.b = p0;
    p0.n += 3;
    p1.n += 3;
    return v;
  }, d);
  for (const v of both(p2, p0)) {
    if (p0.n % 71 === 6) slot = v;
  }
  const t17 = holder.take();
  const g18 = first.bind(null, p0);
  return r16;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const o19: Obj = new Made("c14." + p0.n, p0.n + 7, null);
  const r20 = h7(o19, o19, { tag: "s15." + p0.n, n: p0.n + 8, a: o19, b: null }, (v: Obj): Obj | null => {
    v.a = p0;
    return p0;
  }, d);
  const o21: Obj = new Made("c17." + o19.n, o19.n + 6, o19);
  const { a: t22 } = o19;
  const r23 = f0(o19);
  return r23;
}
function h7(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  try {
    p1.b = p2;
    if (p2.n % 31 === 23) throw p0;
  } finally {
    p2.b = p1;
  }
  const t24 = holder.take();
  const t25 = p2.b;
  if (t25 !== null) {
    t25.a = t25;
  }
  return { tag: "s19." + p2.n, n: p2.n + 3, a: null, b: null };
}
function h8(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  for (const v of both(p1, p1)) {
    if (p1 === v) p1.n += 1000;
  }
  if (p1.n % 41 === 25) holder.hold(p1);
  const g26 = first.bind(null, p0);
  try {
    if (p1 === p1) p1.n += 1000;
    if (p0.n % 41 === 17) throw p0;
  } finally {
    if (p0.n % 53 === 6) kept.push(p1);
  }
  const r27 = f0(p1);
  const w28: Obj = { tag: "s20." + p0.n, n: p0.n + 7, a: p1, b: null };
  w28.a!.b = p0;
  return { tag: "s21." + p0.n, n: p0.n + 1, a: p1, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h5(o2, o0, { tag: "s22." + o2.n, n: o2.n + 1, a: o2, b: null }, (v: Obj): Obj | null => {
      if (o1.n % 41 === 19) slot = o2;
      return { tag: "s23." + v.n, n: v.n + 6, a: o1, b: null };
    }, 1);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 71 === 1) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h7(o2, o2, o2, (v: Obj): Obj | null => {
      v.b = o1;
      v.b = v;
      return v;
    }, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 17) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h1(o0, o2, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 41 === 19) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h3(o0, o1, o0, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 37 === 23) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h8(o2, new Made("c25." + o1.n, o1.n + 5, o1), (v: Obj): Obj | null => {
      o2.n += 3;
      o1.b = null;
      return new Made("c26." + v.n, v.n + 2, o0);
    }, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 37 === 28) kept.push(r33);
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
