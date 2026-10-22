// Made by test/aot/generate-relations-at-random.ts, seed 54: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c0 = p1.n % 2 === 0 ? p1 : p1;
  let c1 = c0;
  for (let k = 0; k < 3; k++) c1 = c1.a ?? p1;
  const g2 = (v: Obj): Obj | null => {
    if (c0.n % 41 === 11) slot = p1;
    return v;
  };
  const o3: Obj = { tag: "s1." + c1.n, n: c1.n + 4, a: p1, b: null };
  const r4 = d > 0 ? h0({ tag: "s2." + p0.n, n: p0.n + 3, a: p1, b: null }, { tag: "s3." + p0.n, n: p0.n + 6, a: o3, b: null }, g2, d - 1) : null;
  const r5 = h6(c1, { tag: "s4." + p1.n, n: p1.n + 1, a: c1, b: null }, (v: Obj): Obj | null => {
    o3.b = o3;
    return c0;
  }, d);
  let c6 = p0;
  for (let k = 0; k < 3; k++) c6 = c6.a ?? o3;
  if (c0.n % 31 === 15) keptFunctions.push(f0);
  return o3;
}
function h1(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const t7 = bag.get(p1.n % 5) ?? null;
  const g8 = first.bind(null, p1);
  const g9 = first.bind(null, p0);
  return null;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  let r10: Obj | null = null;
  try {
    r10 = h3({ tag: "s8." + p1.n, n: p1.n + 2, a: p1, b: null }, p0, p2, d);
  } catch (e) {
    r10 = e as Obj;
  }
  for (const v of both(p0, p1)) {
    v.b = p2;
  }
  bag.set(p2.n % 5, p0);
  for (const v of both(p2, p0)) {
    if (p0.n % 31 === 10) kept.push(p1);
  }
  const t11 = bag.get(p0.n % 5) ?? null;
  const t12 = bag.get(p2.n % 5) ?? null;
  const t13 = slot;
  return t12;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r14 = h6(p1, { tag: "s10." + p0.n, n: p0.n + 5, a: null, b: null }, (v: Obj): Obj | null => {
    p1.a = null;
    if (p2.n % 71 === 13) kept.push(p0);
    if (p1 === v) p1.n += 1000;
    return v;
  }, d);
  const w15: Obj = { tag: "s12." + p0.n, n: p0.n + 3, a: p2, b: null };
  w15.a!.a = p2;
  let c16 = p0;
  for (let k = 0; k < 3; k++) c16 = c16.a ?? p1;
  return c16;
}
function h4(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const w17: Obj = { tag: "s14." + p0.n, n: p0.n + 6, a: p0, b: null };
  w17.a!.b = p1;
  const g18 = first.bind(null, p1);
  p0.a = p1;
  return new Made("c15." + p1.n, p1.n + 6, p0);
}
function h5(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const c19 = p1.n % 2 === 0 ? p1 : p1;
  try {
    c19.b = p2;
    if (c19.n % 89 === 24) throw c19;
  } finally {
    c19.n += 4;
  }
  p2.a = p2;
  for (const v of both(p2, p1)) {
    c19.n += 5;
  }
  const c20 = c19.n % 2 === 0 ? c19 : p1;
  let r21: Obj | null = null;
  try {
    r21 = h6(c19, { tag: "s16." + c20.n, n: c20.n + 6, a: c20, b: null }, (v: Obj): Obj | null => {
      if (p1 === p0) p1.n += 1000;
      if (c19 === c19) c19.n += 1000;
      c19.a = c20;
      return p1;
    }, d);
  } catch (e) {
    r21 = e as Obj;
  }
  let c22 = c19;
  for (let k = 0; k < 3; k++) c22 = c22.a ?? c19;
  return p0;
}
function h6(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  if (p1.n % 61 === 2) slot = p1;
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r23 = h1({ tag: "s20." + o2.n, n: o2.n + 1, a: o1, b: null }, { tag: "s21." + o2.n, n: o2.n + 3, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o2 === o0) o2.n += 1000;
      if (o1.n % 61 === 0) slot = o2;
      o0.b = o0;
      return o1;
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 41 === 18) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h1(o2, new Made("c23." + o0.n, o0.n + 5, null), (v: Obj): Obj | null => {
      if (o0.n % 31 === 1) slot = o0;
      o2.a = o0;
      return o0;
    }, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 89 === 11) kept.push(r24);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r25 = h5(o1, o0, o2, 2);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 37 === 25) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h6(o0, o2, (v: Obj): Obj | null => {
      v.a = null;
      if (v === o0) v.n += 1000;
      if (o0 === o2) o0.n += 1000;
      return o0;
    }, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 89 === 16) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h3(o2, o2, { tag: "s26." + o2.n, n: o2.n + 7, a: o0, b: null }, 1);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 37 === 25) kept.push(r27);
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
