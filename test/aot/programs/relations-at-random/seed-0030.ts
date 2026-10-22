// Made by test/aot/generate-relations-at-random.ts, seed 30: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0.n % 41 === 17) throw p2;
  const r0 = h9(p2, (v: Obj): Obj | null => {
    p2.n += 5;
    p2.a = null;
    p0.n += 2;
    return p0;
  }, d);
  bag.set(p2.n % 5, p2);
  const t1 = slot;
  const t2 = holder.take();
  const t3 = slot;
  const w4: Obj = { tag: "s1." + p0.n, n: p0.n + 9, a: p1, b: null };
  w4.a!.a = p2;
  const t5 = bag.get(p1.n % 5) ?? null;
  return r0;
}
function h1(p0: Obj, f0: Fn, d: number): Obj | null {
  let r6: Obj | null = null;
  try {
    r6 = h4(p0, p0, d);
  } catch (e) {
    r6 = e as Obj;
  }
  const l7 = [p0, p0];
  l7[1].b = p0;
  if (p0.n % 53 === 29) keptFunctions.push(f0);
  try {
    if (p0.n % 61 === 4) slot = p0;
    if (p0.n % 41 === 28) throw p0;
  } finally {
    if (p0.n % 89 === 4) slot = p0;
  }
  const l8 = [p0, p0];
  l8[1].a = p0;
  p0.b = p0;
  const t9 = slot;
  const t10 = holder.take();
  return r6;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  if (p0.n % 31 === 21) slot = p0;
  const t11 = bag.get(p1.n % 5) ?? null;
  const t12 = slot;
  return p0;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const t13 = bag.get(p0.n % 5) ?? null;
  for (const v of both(p1, p0)) {
    p1.n += 3;
  }
  const r14 = h7(p1, p1, p1, d);
  const t15 = holder.take();
  if (p1.n % 31 === 3) holder.hold(p0);
  const t16 = slot;
  for (const v of both(p1, p1)) {
    p1.b = p0;
  }
  return p0;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  try {
    p1.a = p1;
    if (p1.n % 37 === 11) throw p0;
  } finally {
    if (p1.n % 71 === 10) slot = p1;
  }
  return null;
}
function h5(p0: Obj, p1: Obj, d: number): Obj | null {
  const r17 = h8(p0, p1, d);
  holder.hold(p0);
  for (const v of both(p1, p0)) {
    if (p0 === p0) p0.n += 1000;
  }
  bag.set(p0.n % 5, p0);
  const t18 = holder.take();
  return p0;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r19 = d > 0 ? h6(new Made("c8." + p1.n, p1.n + 3, null), p2, new Made("c9." + p2.n, p2.n + 7, null), d - 1) : null;
  const t20 = bag.get(p0.n % 5) ?? null;
  let r21: Obj | null = null;
  try {
    r21 = h8(p2, { tag: "s10." + p0.n, n: p0.n + 3, a: null, b: null }, d);
  } catch (e) {
    r21 = e as Obj;
  }
  const r22 = h8({ tag: "s11." + p0.n, n: p0.n + 2, a: null, b: null }, { tag: "s12." + p1.n, n: p1.n + 9, a: p1, b: null }, d);
  if (p1.n % 37 === 6) throw p1;
  return r21;
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  let c23 = p0;
  for (let k = 0; k < 3; k++) c23 = c23.a ?? p1;
  if (c23.n % 71 === 21) holder.hold(p2);
  const r24 = h8(p2, p1, d);
  const w25: Obj = { tag: "s14." + c23.n, n: c23.n + 1, a: p1, b: null };
  w25.a!.a = p0;
  const r26 = h8(p1, c23, d);
  return r26;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const r27 = d > 0 ? h8(p1, { tag: "s16." + p1.n, n: p1.n + 4, a: p0, b: null }, d - 1) : null;
  bag.set(p0.n % 5, p1);
  return p0;
}
function h9(p0: Obj, f0: Fn, d: number): Obj | null {
  const { b: t28 } = p0;
  const r29 = f0(p0);
  const t30 = p0.b;
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r31 = h8(o1, new Made("c19." + o2.n, o2.n + 2, o2), 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 37 === 4) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h7(o2, o2, o1, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 37 === 24) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h2(o1, new Made("c20." + o1.n, o1.n + 4, o2), 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 31 === 10) kept.push(r33);
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
