// Made by test/aot/generate-relations-at-random.ts, seed 60: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const l0 = [p0, p0];
  l0[1].b = p0;
  const t1 = slot;
  const l2 = [p0, p0];
  l2[0].b = p0;
  const t3 = bag.get(p0.n % 5) ?? null;
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 37 === 4) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const r4 = h1(p0, p0, d);
  if (r4 !== null) {
    if (r4.n % 31 === 11) slot = p0;
  }
  return t1;
}
function h1(p0: Obj, p1: Obj, d: number): Obj | null {
  let r5: Obj | null = null;
  try {
    r5 = h2(p0, p0, p0, d);
  } catch (e) {
    r5 = e as Obj;
  }
  for (const v of both(p0, p1)) {
    if (p1.n % 53 === 23) slot = p0;
  }
  bag.set(p0.n % 5, p1);
  const r6 = h2(p1, p0, p1, d);
  p1.b = null;
  return r5;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  holder.hold(p2);
  p1.a = p0;
  if (p0.n % 37 === 15) throw p0;
  const g7 = first.bind(null, p2);
  p2.b = null;
  return p2;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  bag.set(p2.n % 5, p2);
  const r8 = d > 0 ? h3(p1, p0, p2, d - 1) : null;
  const w9: Obj = { tag: "s3." + p1.n, n: p1.n + 3, a: p0, b: null };
  w9.a!.a = p1;
  const t10 = holder.take();
  const t11 = slot;
  const o12: Obj = { tag: "s4." + p0.n, n: p0.n + 3, a: p0, b: null };
  const t13 = bag.get(o12.n % 5) ?? null;
  return new Made("c5." + o12.n, o12.n + 8, null);
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  for (const v of both(p0, p0)) {
    p1.b = p2;
  }
  const t14 = slot;
  for (const v of both(p2, p1)) {
    v.b = null;
  }
  try {
    if (p0.n % 61 === 20) slot = p1;
    if (p1.n % 37 === 5) throw p1;
  } finally {
    p0.b = p1;
  }
  bag.set(p2.n % 5, p1);
  if (p0.n % 61 === 6) slot = p2;
  return p0;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r15 = h6(p1, p1, d);
  let c16 = p1;
  for (let k = 0; k < 3; k++) c16 = c16.a ?? p1;
  const r17 = h6.call(null, new Made("c7." + p1.n, p1.n + 1, p0), p0, d);
  const l18 = [c16, p1];
  l18[0].a = p0;
  const l19 = [p0, p0];
  l19[1].a = p0;
  const t20 = holder.take();
  if (r15 !== null) {
    r15.a = null;
  }
  let r21: Obj | null = null;
  try {
    r21 = h6(p1, new Made("c8." + c16.n, c16.n + 7, p0), d);
  } catch (e) {
    r21 = e as Obj;
  }
  return { tag: "s9." + p1.n, n: p1.n + 4, a: p0, b: null };
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const w22: Obj = { tag: "s10." + p1.n, n: p1.n + 5, a: p1, b: null };
  w22.a!.b = p1;
  const c23 = p0.n % 2 === 0 ? p0 : p1;
  const w24: Obj = { tag: "s11." + p1.n, n: p1.n + 6, a: p0, b: null };
  w24.a!.b = p1;
  return p1;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r25 = h5(o2, o0, (v: Obj): Obj | null => {
      v.a = o1;
      if (o2.n % 61 === 26) kept.push(o2);
      if (o0.n % 89 === 15) slot = o2;
      return o0;
    }, 1);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 41 === 21) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h3(o2, o1, { tag: "s14." + o1.n, n: o1.n + 2, a: o0, b: null }, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 31 === 28) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h0(o2, (v: Obj): Obj | null => {
      v.n += 2;
      o0.b = null;
      return v;
    }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 41 === 26) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h6(o0, { tag: "s16." + o0.n, n: o0.n + 3, a: o2, b: null }, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 5) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h5({ tag: "s17." + o2.n, n: o2.n + 6, a: o0, b: null }, o2, (v: Obj): Obj | null => {
      o1.a = o1;
      v.b = o0;
      o1.a = null;
      return null;
    }, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 53 === 23) kept.push(r29);
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
