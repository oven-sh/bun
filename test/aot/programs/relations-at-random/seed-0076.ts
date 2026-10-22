// Made by test/aot/generate-relations-at-random.ts, seed 76: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const w0: Obj = { tag: "s0." + p0.n, n: p0.n + 8, a: p0, b: null };
  w0.a!.a = p1;
  for (const v of both(p1, p2)) {
    if (p2.n % 61 === 15) kept.push(p0);
  }
  const { a: t1 } = p2;
  const g2 = first.bind(null, p1);
  if (p0.n % 53 === 25) keptFunctions.push(g2);
  for (const v of both(p2, p2)) {
    if (p0.n % 53 === 29) kept.push(p2);
  }
  return t1;
}
function h1(p0: Obj, d: number): Obj | null {
  const t3 = slot;
  if (p0.n % 53 === 20) slot = p0;
  const r4 = h7(p0, p0, d);
  if (t3 !== null) {
    if (t3.n % 89 === 1) slot = p0;
  }
  const t5 = bag.get(p0.n % 5) ?? null;
  if (p0.n % 89 === 18) throw p0;
  const g6 = first.bind(null, p0);
  return { tag: "s2." + p0.n, n: p0.n + 8, a: p0, b: null };
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const g7 = (v: Obj): Obj | null => {
    p1.n += 3;
    if (v === p0) v.n += 1000;
    return p1;
  };
  const r8 = h5(p0, p1, g7, d);
  const w9: Obj = new Made("c4." + p0.n, p0.n + 9, p0);
  w9.a!.a = p0;
  const o10: Obj = new Made("c5." + p0.n, p0.n + 4, null);
  const t11 = bag.get(p0.n % 5) ?? null;
  const o12: Obj = { tag: "s6." + p1.n, n: p1.n + 2, a: p1, b: null };
  const r13 = g7(p1);
  return r13;
}
function h3(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r14 = d > 0 ? h3(p1, p1, p1, f0, d - 1) : null;
  if (p1.n % 37 === 6) throw p2;
  const t15 = slot;
  return r14;
}
function h4(p0: Obj, d: number): Obj | null {
  const r16 = h6(p0, p0, p0, d);
  const t17 = slot;
  const t18 = p0.b;
  const r19 = h6(p0, p0, { tag: "s9." + p0.n, n: p0.n + 8, a: p0, b: null }, d);
  const t20 = slot;
  const g21 = (v: Obj): Obj | null => {
    if (v === v) v.n += 1000;
    if (v.n % 71 === 1) kept.push(v);
    return null;
  };
  const l22 = [p0, p0];
  l22[1].a = p0;
  const t23 = p0.b;
  return t17;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const w24: Obj = { tag: "s12." + p1.n, n: p1.n + 9, a: p1, b: null };
  w24.a!.b = p0;
  const r25 = h7.apply(null, [p1, new Made("c13." + p0.n, p0.n + 4, p0), d]);
  const g26 = first.bind(null, p1);
  return new Made("c14." + p1.n, p1.n + 9, p1);
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r27 = h7.call(null, p1, p0, d);
  holder.hold(p2);
  if (r27 !== null) {
    p0.a = null;
  }
  const t28 = p1.b;
  return p1;
}
function h7(p0: Obj, p1: Obj, d: number): Obj | null {
  p1.a = null;
  if (p0.n % 89 === 6) slot = p1;
  return p1;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h2({ tag: "s17." + o2.n, n: o2.n + 2, a: o1, b: null }, { tag: "s18." + o2.n, n: o2.n + 6, a: o0, b: null }, 1);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 31 === 0) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h5(o0, o2, (v: Obj): Obj | null => {
      o1.b = o0;
      o1.b = o0;
      if (o1 === v) o1.n += 1000;
      return v;
    }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 21) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h7(new Made("c20." + o0.n, o0.n + 5, null), o0, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 31 === 3) kept.push(r31);
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
