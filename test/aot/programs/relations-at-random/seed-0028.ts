// Made by test/aot/generate-relations-at-random.ts, seed 28: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = h3(p1, d);
  const t1 = bag.get(p2.n % 5) ?? null;
  if (p0 === p1) p0.n += 1000;
  return { tag: "s0." + p2.n, n: p2.n + 8, a: p0, b: null };
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t2 = holder.take();
  for (const v of both(p2, p1)) {
    p2.n += 1;
  }
  const g3 = (v: Obj): Obj | null => {
    p1.a = null;
    p2.n += 5;
    return { tag: "s1." + v.n, n: v.n + 2, a: p0, b: null };
  };
  p2.n += 5;
  const g4 = first.bind(null, p1);
  const c5 = p0.n % 2 === 0 ? p0 : p1;
  try {
    p0.a = null;
    if (p0.n % 37 === 22) throw p2;
  } finally {
    if (p2.n % 37 === 29) kept.push(c5);
  }
  return p1;
}
function h2(p0: Obj, d: number): Obj | null {
  const l6 = [p0, p0];
  l6[1].a = p0;
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 31 === 23) throw p0;
  } finally {
    p0.a = p0;
  }
  const l7 = [p0, p0];
  l7[0].a = p0;
  const w8: Obj = { tag: "s3." + p0.n, n: p0.n + 1, a: p0, b: null };
  w8.a!.a = p0;
  const o9: Obj = { tag: "s4." + p0.n, n: p0.n + 8, a: null, b: null };
  return null;
}
function h3(p0: Obj, d: number): Obj | null {
  const r10 = h7(p0, p0, p0, d);
  let c11 = p0;
  for (let k = 0; k < 3; k++) c11 = c11.b ?? p0;
  if (c11.n % 37 === 7) throw p0;
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.b ?? c11;
  if (p0.n % 61 === 23) throw p0;
  const r13 = h7(new Made("c6." + c11.n, c11.n + 4, c11), p0, p0, d);
  return c12;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  for (const v of both(p0, p1)) {
    p1.b = p0;
  }
  let r14: Obj | null = null;
  try {
    r14 = h6(p0, (v: Obj): Obj | null => {
      if (p1.n % 41 === 8) slot = v;
      return p1;
    }, d);
  } catch (e) {
    r14 = e as Obj;
  }
  if (r14 !== null) {
    p1.n += 3;
  }
  const c15 = p1.n % 2 === 0 ? p1 : p1;
  holder.hold(p0);
  return r14;
}
function h5(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const { b: t16 } = p1;
  const o17: Obj = { tag: "s10." + p0.n, n: p0.n + 6, a: null, b: null };
  const t18 = bag.get(p0.n % 5) ?? null;
  return t18;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const r19 = h7.apply(null, [p0, p0, p0, d]);
  const r20 = f0(p0);
  const o21: Obj = new Made("c12." + p0.n, p0.n + 2, null);
  if (p0 === o21) p0.n += 1000;
  if (p0.n % 53 === 21) kept.push(p0);
  const g22 = (v: Obj): Obj | null => {
    if (o21.n % 89 === 17) kept.push(o21);
    p0.a = null;
    return v;
  };
  for (const v of both(o21, p0)) {
    if (v.n % 41 === 5) slot = o21;
  }
  const t23 = slot;
  return r19;
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t24 = p2.b;
  if (p1.n % 37 === 25) throw p0;
  const c25 = p2.n % 2 === 0 ? p2 : p1;
  bag.set(p2.n % 5, p1);
  c25.b = null;
  const t26 = slot;
  return p1;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r27 = h4(o1, { tag: "s16." + o0.n, n: o0.n + 5, a: null, b: null }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 53 === 1) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h1({ tag: "s17." + o1.n, n: o1.n + 6, a: null, b: null }, { tag: "s18." + o1.n, n: o1.n + 2, a: o1, b: null }, o1, (v: Obj): Obj | null => {
      if (o2.n % 61 === 1) slot = o2;
      if (v.n % 53 === 16) kept.push(o2);
      return new Made("c19." + v.n, v.n + 8, o1);
    }, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 31 === 16) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h4(o2, { tag: "s20." + o2.n, n: o2.n + 5, a: o2, b: null }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 31 === 23) kept.push(r29);
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
