// Made by test/aot/generate-relations-at-random.ts, seed 8: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  for (const v of both(p0, p1)) {
    p0.b = p0;
  }
  const t0 = holder.take();
  if (p0.n % 53 === 9) throw p0;
  const t1 = bag.get(p1.n % 5) ?? null;
  return null;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g2 = (v: Obj): Obj | null => {
    p1.n += 3;
    return { tag: "s1." + v.n, n: v.n + 8, a: p0, b: null };
  };
  const r3 = h3({ tag: "s2." + p0.n, n: p0.n + 2, a: null, b: null }, d);
  p2.n += 1;
  for (const v of both(p1, p0)) {
    if (p0.n % 37 === 29) kept.push(v);
  }
  if (p2.n % 31 === 17) kept.push(p2);
  const r4 = h3.apply(null, [p0, d]);
  return null;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 41 === 28) throw p0;
  } finally {
    if (p0.n % 61 === 3) kept.push(p1);
  }
  if (p0.n % 31 === 16) holder.hold(p0);
  const r5 = d > 0 ? h2(p0, { tag: "s4." + p1.n, n: p1.n + 8, a: p0, b: null }, d - 1) : null;
  const c6 = p1.n % 2 === 0 ? p1 : p0;
  for (const v of both(p0, p0)) {
    c6.a = v;
  }
  return p1;
}
function h3(p0: Obj, d: number): Obj | null {
  const t7 = holder.take();
  const g8 = first.bind(null, p0);
  const r9 = h4({ tag: "s6." + p0.n, n: p0.n + 8, a: p0, b: null }, d);
  p0.a = null;
  return { tag: "s7." + p0.n, n: p0.n + 6, a: p0, b: null };
}
function h4(p0: Obj, d: number): Obj | null {
  const t10 = holder.take();
  const t11 = slot;
  const c12 = p0.n % 2 === 0 ? p0 : p0;
  const r13 = h5(c12, d);
  return r13;
}
function h5(p0: Obj, d: number): Obj | null {
  if (p0.n % 61 === 5) throw p0;
  for (const v of both(p0, p0)) {
    v.a = null;
  }
  for (const v of both(p0, p0)) {
    if (v === v) v.n += 1000;
  }
  if (p0.n % 41 === 17) slot = p0;
  const r14 = d > 0 ? h5({ tag: "s9." + p0.n, n: p0.n + 8, a: p0, b: null }, d - 1) : null;
  try {
    if (p0.n % 61 === 7) slot = p0;
    if (p0.n % 37 === 2) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  let c15 = p0;
  for (let k = 0; k < 3; k++) c15 = c15.b ?? p0;
  return c15;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r16 = h5(o2, 2);
    if (r16 !== null) {
      sum += r16.n;
      if (r16.n % 31 === 20) kept.push(r16);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r17 = h0(o0, o0, (v: Obj): Obj | null => {
      v.a = null;
      if (o1 === o2) o1.n += 1000;
      return o2;
    }, 2);
    if (r17 !== null) {
      sum += r17.n;
      if (r17.n % 31 === 27) kept.push(r17);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r18 = h0(o2, o0, (v: Obj): Obj | null => {
      o0.n += 5;
      o0.a = v;
      o2.n += 2;
      return o0;
    }, 2);
    if (r18 !== null) {
      sum += r18.n;
      if (r18.n % 71 === 25) kept.push(r18);
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
