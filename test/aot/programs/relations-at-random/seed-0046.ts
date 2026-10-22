// Made by test/aot/generate-relations-at-random.ts, seed 46: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = h2.call(null, { tag: "s0." + p0.n, n: p0.n + 6, a: p1, b: null }, d);
  let r1: Obj | null = null;
  try {
    r1 = h1(p1, p0, p2, (v: Obj): Obj | null => {
      if (p0.n % 37 === 17) slot = v;
      if (p2.n % 41 === 27) kept.push(p2);
      return p0;
    }, d);
  } catch (e) {
    r1 = e as Obj;
  }
  if (p1.n % 61 === 0) slot = p0;
  if (p0.n % 89 === 8) throw p1;
  if (p1.n % 71 === 14) throw p2;
  bag.set(p1.n % 5, p2);
  const c2 = p1.n % 2 === 0 ? p1 : p1;
  return { tag: "s2." + p1.n, n: p1.n + 4, a: c2, b: null };
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  if (p2.n % 31 === 7) keptFunctions.push(f0);
  const g3 = first.bind(null, p0);
  const w4: Obj = { tag: "s3." + p0.n, n: p0.n + 2, a: p1, b: null };
  w4.a!.b = p0;
  let r5: Obj | null = null;
  try {
    r5 = h4(p2, { tag: "s4." + p0.n, n: p0.n + 6, a: p2, b: null }, p2, d);
  } catch (e) {
    r5 = e as Obj;
  }
  p0.a = p1;
  const t6 = slot;
  return r5;
}
function h2(p0: Obj, d: number): Obj | null {
  if (p0.n % 53 === 4) throw p0;
  const { b: t7 } = p0;
  const t8 = slot;
  const c9 = p0.n % 2 === 0 ? p0 : p0;
  let r10: Obj | null = null;
  try {
    r10 = h3(c9, d);
  } catch (e) {
    r10 = e as Obj;
  }
  const r11 = h4.apply(null, [p0, p0, p0, d]);
  if (t7 !== null) {
    p0.n += 4;
  }
  try {
    c9.n += 3;
    if (p0.n % 37 === 12) throw c9;
  } finally {
    if (c9 === c9) c9.n += 1000;
  }
  return t7;
}
function h3(p0: Obj, d: number): Obj | null {
  const t12 = p0.b;
  const t13 = p0.a;
  const w14: Obj = { tag: "s7." + p0.n, n: p0.n + 1, a: p0, b: null };
  w14.a!.b = p0;
  const g15 = (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    return v;
  };
  return null;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g16 = first.bind(null, p0);
  const g17 = first.bind(null, p2);
  const r18 = h5.apply(null, [p2, d]);
  const c19 = p0.n % 2 === 0 ? p0 : p2;
  return p2;
}
function h5(p0: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  const l20 = [p0, p0];
  l20[0].b = p0;
  return { tag: "s11." + p0.n, n: p0.n + 8, a: null, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h2(o1, 2);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 53 === 11) kept.push(r21);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r22 = h5(o1, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 37 === 12) kept.push(r22);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r23 = h5(o1, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 53 === 13) kept.push(r23);
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
