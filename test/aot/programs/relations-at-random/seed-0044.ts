// Made by test/aot/generate-relations-at-random.ts, seed 44: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0.n % 89 === 12) throw p0;
  p0.n += 2;
  bag.set(p0.n % 5, p0);
  if (p0.n % 31 === 18) throw p0;
  return null;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  holder.hold(p2);
  const t0 = slot;
  const r1 = d > 0 ? h1({ tag: "s1." + p0.n, n: p0.n + 1, a: null, b: null }, new Made("c2." + p2.n, p2.n + 8, null), p0, d - 1) : null;
  const t2 = bag.get(p1.n % 5) ?? null;
  const c3 = p0.n % 2 === 0 ? p0 : p2;
  return r1;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const r4 = d > 0 ? h2(p1, p1, d - 1) : null;
  const t5 = slot;
  const g6 = first.bind(null, p0);
  return p0;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const t7 = holder.take();
  const l8 = [p0, p0];
  l8[0].a = p0;
  const t9 = holder.take();
  const g10 = (v: Obj): Obj | null => {
    if (v.n % 31 === 17) slot = p1;
    if (v.n % 53 === 18) slot = v;
    return v;
  };
  if (t9 !== null) {
    if (p1.n % 53 === 14) slot = p0;
  }
  if (t9 !== null) {
    t9.n += 4;
  }
  const l11 = [p0, p1];
  l11[1].b = p1;
  return t7;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const g12 = (v: Obj): Obj | null => {
    if (p0.n % 31 === 4) kept.push(v);
    v.b = p0;
    return v;
  };
  try {
    if (p2.n % 37 === 6) kept.push(p1);
    if (p0.n % 41 === 9) throw p0;
  } finally {
    if (p2.n % 37 === 19) slot = p0;
  }
  return p2;
}
function h5(p0: Obj, d: number): Obj | null {
  const l13 = [p0, p0];
  l13[1].b = p0;
  bag.set(p0.n % 5, p0);
  const r14 = h6(p0, p0, new Made("c9." + p0.n, p0.n + 5, null), d);
  const t15 = holder.take();
  bag.set(p0.n % 5, p0);
  return null;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t16 = slot;
  const r17 = d > 0 ? h6(new Made("c11." + p2.n, p2.n + 5, null), { tag: "s12." + p2.n, n: p2.n + 3, a: p1, b: null }, p1, d - 1) : null;
  try {
    p2.n += 3;
    if (p1.n % 41 === 23) throw p2;
  } finally {
    if (p1.n % 71 === 16) slot = p0;
  }
  return p2;
}
function h7(p0: Obj, d: number): Obj | null {
  try {
    p0.a = p0;
    if (p0.n % 31 === 25) throw p0;
  } finally {
    p0.b = p0;
  }
  const l18 = [p0, p0];
  l18[0].b = p0;
  const o19: Obj = new Made("c14." + p0.n, p0.n + 6, null);
  const t20 = o19.b;
  return t20;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const g21 = first.bind(null, p0);
  const c22 = p1.n % 2 === 0 ? p1 : p1;
  const l23 = [p1, c22];
  l23[0].a = c22;
  if (c22.n % 31 === 25) kept.push(c22);
  return p0;
}
function h9(p0: Obj, p1: Obj, d: number): Obj | null {
  const t24 = holder.take();
  const o25: Obj = { tag: "s17." + p0.n, n: p0.n + 7, a: p0, b: null };
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h5(o0, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 8) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h0(o2, (v: Obj): Obj | null => {
      v.b = o2;
      return null;
    }, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 41 === 22) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h6(o0, o0, o0, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 89 === 12) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h3(o1, o1, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 89 === 5) kept.push(r29);
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
