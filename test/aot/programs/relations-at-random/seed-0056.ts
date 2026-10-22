// Made by test/aot/generate-relations-at-random.ts, seed 56: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, d: number): Obj | null {
  const g0 = first.bind(null, p0);
  const r1 = h5(p1, d);
  const r2 = g0(p1);
  if (p1.n % 31 === 2) throw p0;
  return null;
}
function h1(p0: Obj, d: number): Obj | null {
  const w3: Obj = { tag: "s1." + p0.n, n: p0.n + 2, a: p0, b: null };
  w3.a!.b = p0;
  const t4 = bag.get(p0.n % 5) ?? null;
  const t5 = bag.get(p0.n % 5) ?? null;
  return new Made("c2." + p0.n, p0.n + 6, p0);
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const g6 = first.bind(null, p1);
  const t7 = holder.take();
  try {
    if (p1.n % 37 === 28) kept.push(p0);
    if (p1.n % 71 === 10) throw p0;
  } finally {
    p0.a = p1;
  }
  const o8: Obj = new Made("c3." + p1.n, p1.n + 8, null);
  if (t7 !== null) {
    if (p0.n % 53 === 18) slot = p0;
  }
  return o8;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const l9 = [p1, p1];
  l9[1].a = p1;
  const t10 = bag.get(p1.n % 5) ?? null;
  const t11 = bag.get(p1.n % 5) ?? null;
  const r12 = h5(p1, d);
  let r13: Obj | null = null;
  try {
    r13 = h5(p1, d);
  } catch (e) {
    r13 = e as Obj;
  }
  const r14 = h4({ tag: "s5." + p1.n, n: p1.n + 4, a: p1, b: null }, p1, (v: Obj): Obj | null => {
    p1.a = v;
    p1.b = p1;
    return v;
  }, d);
  const g15 = first.bind(null, p0);
  return t10;
}
function h4(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const t16 = holder.take();
  const l17 = [p1, p1];
  l17[0].a = p0;
  if (t16 !== null) {
    p1.a = null;
  }
  return p1;
}
function h5(p0: Obj, d: number): Obj | null {
  const r18 = d > 0 ? h5(p0, d - 1) : null;
  if (r18 !== null) {
    if (p0 === r18) p0.n += 1000;
  }
  holder.hold(p0);
  const t19 = bag.get(p0.n % 5) ?? null;
  if (p0.n % 41 === 22) kept.push(p0);
  const o20: Obj = new Made("c9." + p0.n, p0.n + 3, null);
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h3(o1, o2, 2);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 41 === 8) kept.push(r21);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r22 = h4(o0, { tag: "s11." + o1.n, n: o1.n + 3, a: o0, b: null }, (v: Obj): Obj | null => {
      o0.n += 1;
      return v;
    }, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 8) kept.push(r22);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r23 = h3(new Made("c13." + o1.n, o1.n + 8, o1), o1, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 53 === 15) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h2(o0, o2, 2);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 31 === 16) kept.push(r24);
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
