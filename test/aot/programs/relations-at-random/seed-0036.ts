// Made by test/aot/generate-relations-at-random.ts, seed 36: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r0 = f0(p0);
  if (p0.n % 31 === 3) keptFunctions.push(f0);
  let r1: Obj | null = null;
  try {
    r1 = h2(p0, { tag: "s0." + p2.n, n: p2.n + 8, a: p1, b: null }, { tag: "s1." + p2.n, n: p2.n + 7, a: null, b: null }, d);
  } catch (e) {
    r1 = e as Obj;
  }
  return p2;
}
function h1(p0: Obj, d: number): Obj | null {
  const t2 = bag.get(p0.n % 5) ?? null;
  const w3: Obj = { tag: "s3." + p0.n, n: p0.n + 4, a: p0, b: null };
  w3.a!.b = p0;
  if (t2 !== null) {
    if (p0.n % 89 === 23) slot = t2;
  }
  const c4 = p0.n % 2 === 0 ? p0 : p0;
  const c5 = p0.n % 2 === 0 ? p0 : c4;
  const l6 = [c5, c5];
  l6[0].a = p0;
  const t7 = bag.get(c5.n % 5) ?? null;
  return t2;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g8 = first.bind(null, p1);
  const t9 = holder.take();
  return p2;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t10 = p0.b;
  if (p2.n % 37 === 17) throw p2;
  const t11 = holder.take();
  const t12 = bag.get(p1.n % 5) ?? null;
  for (const v of both(p1, p0)) {
    if (v.n % 89 === 17) slot = p0;
  }
  const c13 = p2.n % 2 === 0 ? p2 : p1;
  if (t11 !== null) {
    p2.b = p1;
  }
  p2.a = null;
  return c13;
}
function h4(p0: Obj, d: number): Obj | null {
  let r14: Obj | null = null;
  try {
    r14 = h9(p0, p0, { tag: "s7." + p0.n, n: p0.n + 2, a: p0, b: null }, d);
  } catch (e) {
    r14 = e as Obj;
  }
  let c15 = p0;
  for (let k = 0; k < 3; k++) c15 = c15.a ?? p0;
  const g16 = first.bind(null, c15);
  const l17 = [p0, p0];
  l17[0].a = p0;
  let r18: Obj | null = null;
  try {
    r18 = h5(p0, { tag: "s8." + c15.n, n: c15.n + 9, a: null, b: null }, g16, d);
  } catch (e) {
    r18 = e as Obj;
  }
  return { tag: "s9." + c15.n, n: c15.n + 8, a: null, b: null };
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const c19 = p0.n % 2 === 0 ? p0 : p1;
  const t20 = holder.take();
  const g21 = (v: Obj): Obj | null => {
    p1.a = c19;
    if (v.n % 37 === 9) kept.push(p0);
    return { tag: "s10." + v.n, n: v.n + 9, a: p0, b: null };
  };
  try {
    p0.n += 5;
    if (c19.n % 31 === 1) throw p1;
  } finally {
    if (p1 === c19) p1.n += 1000;
  }
  let r22: Obj | null = null;
  try {
    r22 = h9(c19, p0, p0, d);
  } catch (e) {
    r22 = e as Obj;
  }
  if (c19.n % 37 === 12) keptFunctions.push(f0);
  c19.a = null;
  const w23: Obj = new Made("c11." + c19.n, c19.n + 4, c19);
  w23.a!.b = c19;
  return p0;
}
function h6(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t24 = holder.take();
  if (p2.n % 89 === 15) throw p0;
  if (p2.n % 71 === 5) slot = p2;
  const r25 = f0(p1);
  const t26 = bag.get(p0.n % 5) ?? null;
  return p0;
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r27 = h8.call(null, new Made("c14." + p0.n, p0.n + 2, p1), { tag: "s15." + p1.n, n: p1.n + 1, a: p1, b: null }, p1, (v: Obj): Obj | null => {
    if (p0.n % 53 === 25) slot = v;
    if (p2.n % 61 === 6) slot = p2;
    if (p0.n % 41 === 13) slot = p0;
    return p2;
  }, d);
  const r28 = h8({ tag: "s17." + p1.n, n: p1.n + 9, a: p1, b: null }, p0, p2, (v: Obj): Obj | null => {
    if (p1.n % 41 === 13) kept.push(v);
    p0.b = p1;
    p1.n += 2;
    return p0;
  }, d);
  try {
    p1.b = p1;
    if (p2.n % 61 === 23) throw p2;
  } finally {
    if (p0 === p1) p0.n += 1000;
  }
  return p1;
}
function h8(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const l29 = [p1, p0];
  l29[1].a = p0;
  const g30 = (v: Obj): Obj | null => {
    p0.a = p2;
    return p0;
  };
  if (p0.n % 71 === 25) throw p1;
  return p2;
}
function h9(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p0.n % 41 === 13) throw p2;
  bag.set(p1.n % 5, p0);
  return p2;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r31 = h1({ tag: "s23." + o2.n, n: o2.n + 1, a: o2, b: null }, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 53 === 23) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h1(o0, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 71 === 28) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h4({ tag: "s24." + o2.n, n: o2.n + 4, a: o0, b: null }, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 8) kept.push(r33);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r34 = h6(o1, { tag: "s25." + o1.n, n: o1.n + 8, a: o1, b: null }, o1, (v: Obj): Obj | null => {
      if (o0.n % 89 === 10) slot = o1;
      return v;
    }, 0);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 31 === 5) kept.push(r34);
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
