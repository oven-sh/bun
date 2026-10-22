// Made by test/aot/generate-relations-at-random.ts, seed 12: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, d: number): Obj | null {
  try {
    p0.a = null;
    if (p0.n % 53 === 7) throw p0;
  } finally {
    p0.a = p0;
  }
  const r0 = h4(p0, p0, new Made("c0." + p0.n, p0.n + 1, null), (v: Obj): Obj | null => {
    v.b = p0;
    if (p0.n % 41 === 25) kept.push(p0);
    return v;
  }, d);
  holder.hold(p0);
  const r1 = h1(p0, p0, p0, (v: Obj): Obj | null => {
    p0.b = v;
    p0.a = v;
    v.n += 2;
    return p0;
  }, d);
  const r2 = h6.call(null, new Made("c3." + p0.n, p0.n + 8, null), p0, d);
  return r0;
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const w3: Obj = { tag: "s5." + p2.n, n: p2.n + 2, a: p0, b: null };
  w3.a!.b = p0;
  let r4: Obj | null = null;
  try {
    r4 = h5(p0, p0, p1, f0, d);
  } catch (e) {
    r4 = e as Obj;
  }
  const r5 = d > 0 ? h1(p2, p2, new Made("c6." + p0.n, p0.n + 5, p0), f0, d - 1) : null;
  return p0;
}
function h2(p0: Obj, d: number): Obj | null {
  holder.hold(p0);
  let r6: Obj | null = null;
  try {
    r6 = h5({ tag: "s8." + p0.n, n: p0.n + 6, a: p0, b: null }, p0, p0, (v: Obj): Obj | null => {
      if (v === v) v.n += 1000;
      return v;
    }, d);
  } catch (e) {
    r6 = e as Obj;
  }
  if (p0.n % 71 === 14) throw p0;
  if (p0.n % 41 === 23) throw p0;
  const { b: t7 } = p0;
  if (p0.n % 61 === 15) throw p0;
  return t7;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const t8 = holder.take();
  const r9 = h4({ tag: "s11." + p0.n, n: p0.n + 2, a: null, b: null }, p0, p1, (v: Obj): Obj | null => {
    if (v.n % 53 === 12) slot = p0;
    p0.b = null;
    return p0;
  }, d);
  const t10 = p0.b;
  if (p1 === p0) p1.n += 1000;
  const o11: Obj = { tag: "s13." + p1.n, n: p1.n + 6, a: null, b: null };
  return r9;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  let r12: Obj | null = null;
  try {
    r12 = h5(p2, p2, p0, (v: Obj): Obj | null => {
      p2.n += 5;
      if (v === p2) v.n += 1000;
      return { tag: "s15." + v.n, n: v.n + 7, a: p2, b: null };
    }, d);
  } catch (e) {
    r12 = e as Obj;
  }
  p0.n += 3;
  if (r12 !== null) {
    if (p0.n % 53 === 6) kept.push(p1);
  }
  const g13 = first.bind(null, p2);
  const t14 = bag.get(p0.n % 5) ?? null;
  return null;
}
function h5(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r15 = h6.apply(null, [p0, p0, d]);
  let r16: Obj | null = null;
  try {
    r16 = h6(p1, p0, d);
  } catch (e) {
    r16 = e as Obj;
  }
  if (p2.n % 89 === 11) kept.push(p0);
  if (p1.n % 53 === 15) holder.hold(p0);
  return p0;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const o17: Obj = { tag: "s18." + p1.n, n: p1.n + 9, a: p1, b: null };
  o17.n += 3;
  if (p0.n % 37 === 0) kept.push(o17);
  const t18 = bag.get(p1.n % 5) ?? null;
  const t19 = p0.b;
  return t19;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r20 = h0(o1, 0);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 53 === 20) kept.push(r20);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r21 = h5(o2, o1, o1, (v: Obj): Obj | null => {
      if (o2 === o2) o2.n += 1000;
      v.b = o0;
      o0.a = null;
      return null;
    }, 0);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 41 === 12) kept.push(r21);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r22 = h6(o1, o2, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 71 === 22) kept.push(r22);
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
