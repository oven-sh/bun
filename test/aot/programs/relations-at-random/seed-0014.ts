// Made by test/aot/generate-relations-at-random.ts, seed 14: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = first.bind(null, p1);
  const r1 = g0(p1);
  const r2 = g0(p0);
  if (r2 !== null) {
    if (p1.n % 61 === 8) slot = r2;
  }
  const t3 = p0.b;
  let r4: Obj | null = null;
  try {
    r4 = h1(p0, p0, g0, d);
  } catch (e) {
    r4 = e as Obj;
  }
  const t5 = holder.take();
  return t3;
}
function h1(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r6 = f0(p0);
  if (r6 !== null) {
    p1.b = null;
  }
  if (p0.n % 53 === 28) keptFunctions.push(f0);
  const t7 = bag.get(p0.n % 5) ?? null;
  const g8 = (v: Obj): Obj | null => {
    if (v.n % 61 === 9) kept.push(p1);
    p0.n += 4;
    return null;
  };
  const t9 = slot;
  p1.b = p0;
  return p1;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const l10 = [p0, p0];
  l10[1].a = p1;
  const t11 = bag.get(p0.n % 5) ?? null;
  bag.set(p0.n % 5, p1);
  if (p1.n % 71 === 2) holder.hold(p0);
  const r12 = h6(p1, (v: Obj): Obj | null => {
    if (p1.n % 31 === 19) slot = p1;
    p1.b = null;
    p1.b = null;
    return null;
  }, d);
  return r12;
}
function h3(p0: Obj, d: number): Obj | null {
  const { a: t13 } = p0;
  const c14 = p0.n % 2 === 0 ? p0 : p0;
  const g15 = (v: Obj): Obj | null => {
    p0.a = null;
    return v;
  };
  const l16 = [c14, p0];
  l16[1].a = p0;
  const t17 = holder.take();
  let r18: Obj | null = null;
  try {
    r18 = h6(c14, g15, d);
  } catch (e) {
    r18 = e as Obj;
  }
  return t13;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r19 = h5({ tag: "s7." + p1.n, n: p1.n + 4, a: null, b: null }, d);
  const t20 = slot;
  if (p1.n % 53 === 7) kept.push(p1);
  const g21 = first.bind(null, p2);
  try {
    p1.a = p1;
    if (p1.n % 71 === 14) throw p2;
  } finally {
    if (p2.n % 41 === 1) slot = p0;
  }
  const c22 = p0.n % 2 === 0 ? p0 : p1;
  const l23 = [p1, p0];
  l23[0].a = c22;
  return t20;
}
function h5(p0: Obj, d: number): Obj | null {
  const l24 = [p0, p0];
  l24[0].b = p0;
  const t25 = slot;
  const c26 = p0.n % 2 === 0 ? p0 : p0;
  let c27 = c26;
  for (let k = 0; k < 3; k++) c27 = c27.a ?? c26;
  return c26;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const g28 = first.bind(null, p0);
  holder.hold(p0);
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 71 === 3) throw p0;
  } finally {
    p0.b = p0;
  }
  holder.hold(p0);
  return new Made("c10." + p0.n, p0.n + 1, null);
}
function h7(p0: Obj, p1: Obj, d: number): Obj | null {
  if (p1.n % 53 === 21) kept.push(p0);
  const o29: Obj = { tag: "s11." + p0.n, n: p0.n + 1, a: p0, b: null };
  const r30 = d > 0 ? h7(o29, { tag: "s12." + p1.n, n: p1.n + 1, a: null, b: null }, d - 1) : null;
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r31 = h1(o0, o0, (v: Obj): Obj | null => {
      o1.b = null;
      return v;
    }, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 27) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h5(o0, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 37 === 28) kept.push(r32);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r33 = h3(o0, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 41 === 22) kept.push(r33);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r34 = h5(o1, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 71 === 25) kept.push(r34);
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
