// Made by test/aot/generate-relations-at-random.ts, seed 62: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = h2.apply(null, [p0, d]);
  if (p0.n % 37 === 2) slot = p0;
  const r1 = h8({ tag: "s0." + p0.n, n: p0.n + 6, a: p0, b: null }, p0, p0, (v: Obj): Obj | null => {
    if (p0.n % 61 === 16) kept.push(p0);
    return v;
  }, d);
  if (p0 === p0) p0.n += 1000;
  return null;
}
function h1(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  if (p1 === p0) p1.n += 1000;
  p1.b = p0;
  const t2 = slot;
  const r3 = h6.call(null, { tag: "s3." + p1.n, n: p1.n + 4, a: p0, b: null }, d);
  try {
    p1.b = null;
    if (p0.n % 41 === 28) throw p1;
  } finally {
    if (p0.n % 53 === 12) slot = p0;
  }
  const g4 = (v: Obj): Obj | null => {
    p0.b = p1;
    v.b = p0;
    return p1;
  };
  const g5 = first.bind(null, p0);
  const t6 = holder.take();
  return { tag: "s5." + p1.n, n: p1.n + 2, a: null, b: null };
}
function h2(p0: Obj, d: number): Obj | null {
  const r7 = h5.call(null, p0, p0, (v: Obj): Obj | null => {
    p0.a = p0;
    v.b = v;
    return null;
  }, d);
  const r8 = h6.call(null, { tag: "s7." + p0.n, n: p0.n + 6, a: null, b: null }, d);
  const t9 = p0.b;
  const t10 = holder.take();
  const o11: Obj = new Made("c8." + p0.n, p0.n + 9, null);
  const l12 = [p0, p0];
  l12[0].a = o11;
  bag.set(o11.n % 5, o11);
  const t13 = bag.get(p0.n % 5) ?? null;
  return r7;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const c14 = p0.n % 2 === 0 ? p0 : p2;
  if (c14.n % 89 === 6) throw c14;
  const c15 = p2.n % 2 === 0 ? p2 : c14;
  return p0;
}
function h4(p0: Obj, d: number): Obj | null {
  const r16 = h7(p0, { tag: "s11." + p0.n, n: p0.n + 6, a: p0, b: null }, d);
  let r17: Obj | null = null;
  try {
    r17 = h6({ tag: "s12." + p0.n, n: p0.n + 3, a: p0, b: null }, d);
  } catch (e) {
    r17 = e as Obj;
  }
  return r17;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const c18 = p1.n % 2 === 0 ? p1 : p1;
  const o19: Obj = { tag: "s14." + p0.n, n: p0.n + 9, a: null, b: null };
  for (const v of both(p0, o19)) {
    if (p0.n % 53 === 19) slot = o19;
  }
  let c20 = p0;
  for (let k = 0; k < 3; k++) c20 = c20.a ?? o19;
  return null;
}
function h6(p0: Obj, d: number): Obj | null {
  let r21: Obj | null = null;
  try {
    r21 = h7(p0, p0, d);
  } catch (e) {
    r21 = e as Obj;
  }
  const g22 = (v: Obj): Obj | null => {
    p0.n += 2;
    p0.b = null;
    return p0;
  };
  let r23: Obj | null = null;
  try {
    r23 = h8(p0, p0, new Made("c17." + p0.n, p0.n + 7, null), (v: Obj): Obj | null => {
      v.b = v;
      v.b = null;
      return null;
    }, d);
  } catch (e) {
    r23 = e as Obj;
  }
  return { tag: "s19." + p0.n, n: p0.n + 2, a: p0, b: null };
}
function h7(p0: Obj, p1: Obj, d: number): Obj | null {
  const r24 = d > 0 ? h7(p1, new Made("c20." + p1.n, p1.n + 1, p1), d - 1) : null;
  let r25: Obj | null = null;
  try {
    r25 = h8({ tag: "s21." + p0.n, n: p0.n + 3, a: null, b: null }, p0, { tag: "s22." + p1.n, n: p1.n + 8, a: null, b: null }, (v: Obj): Obj | null => {
      p1.a = p1;
      return { tag: "s23." + v.n, n: v.n + 4, a: null, b: null };
    }, d);
  } catch (e) {
    r25 = e as Obj;
  }
  if (r24 !== null) {
    if (p1 === r24) p1.n += 1000;
  }
  return r24;
}
function h8(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  let c26 = p1;
  for (let k = 0; k < 3; k++) c26 = c26.a ?? p1;
  const t27 = slot;
  for (const v of both(c26, p1)) {
    p0.a = p2;
  }
  if (t27 !== null) {
    p2.b = t27;
  }
  let c28 = p2;
  for (let k = 0; k < 3; k++) c28 = c28.a ?? p0;
  return c28;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h5({ tag: "s26." + o2.n, n: o2.n + 2, a: null, b: null }, { tag: "s27." + o0.n, n: o0.n + 8, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o2.n % 31 === 1) kept.push(o1);
      if (o0.n % 53 === 25) slot = v;
      o1.a = o0;
      return v;
    }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 53 === 1) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h2(o2, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 17) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h7(o2, new Made("c29." + o1.n, o1.n + 4, o0), 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 53 === 21) kept.push(r31);
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
