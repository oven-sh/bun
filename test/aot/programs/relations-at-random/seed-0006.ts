// Made by test/aot/generate-relations-at-random.ts, seed 6: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
    p0.b = null;
    if (p0.n % 89 === 20) throw p0;
  } finally {
    p0.a = null;
  }
  const g0 = (v: Obj): Obj | null => {
    if (v === p0) v.n += 1000;
    return { tag: "s0." + v.n, n: v.n + 6, a: v, b: null };
  };
  const g1 = (v: Obj): Obj | null => {
    if (v.n % 41 === 19) kept.push(p0);
    if (p0.n % 37 === 9) kept.push(p0);
    p0.a = p0;
    return p0;
  };
  const g2 = (v: Obj): Obj | null => {
    v.b = p0;
    return p0;
  };
  return p0;
}
function h1(p0: Obj, d: number): Obj | null {
  p0.n += 5;
  const g3 = (v: Obj): Obj | null => {
    p0.a = v;
    p0.b = p0;
    return p0;
  };
  bag.set(p0.n % 5, p0);
  let r4: Obj | null = null;
  try {
    r4 = h6(new Made("c5." + p0.n, p0.n + 7, null), d);
  } catch (e) {
    r4 = e as Obj;
  }
  const o5: Obj = { tag: "s6." + p0.n, n: p0.n + 6, a: p0, b: null };
  try {
    if (o5 === o5) o5.n += 1000;
    if (o5.n % 71 === 8) throw p0;
  } finally {
    p0.n += 4;
  }
  const r6 = g3(o5);
  for (const v of both(p0, p0)) {
    o5.b = v;
  }
  return o5;
}
function h2(p0: Obj, f0: Fn, d: number): Obj | null {
  if (p0.n % 61 === 27) keptFunctions.push(f0);
  const t7 = holder.take();
  let r8: Obj | null = null;
  try {
    r8 = h6(p0, d);
  } catch (e) {
    r8 = e as Obj;
  }
  const t9 = p0.b;
  try {
    if (p0.n % 37 === 12) kept.push(p0);
    if (p0.n % 89 === 12) throw p0;
  } finally {
    p0.b = p0;
  }
  return new Made("c8." + p0.n, p0.n + 4, null);
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const l10 = [p2, p0];
  l10[1].a = p2;
  const r11 = h7.call(null, p0, p2, p0, d);
  p0.n += 2;
  const g12 = first.bind(null, p2);
  let c13 = p2;
  for (let k = 0; k < 3; k++) c13 = c13.b ?? p0;
  return p0;
}
function h4(p0: Obj, d: number): Obj | null {
  const l14 = [p0, p0];
  l14[0].b = p0;
  const { a: t15 } = p0;
  const g16 = (v: Obj): Obj | null => {
    v.a = p0;
    v.a = null;
    if (p0 === v) p0.n += 1000;
    return v;
  };
  let r17: Obj | null = null;
  try {
    r17 = h6({ tag: "s11." + p0.n, n: p0.n + 3, a: p0, b: null }, d);
  } catch (e) {
    r17 = e as Obj;
  }
  if (p0.n % 89 === 10) throw p0;
  let c18 = p0;
  for (let k = 0; k < 3; k++) c18 = c18.a ?? p0;
  const o19: Obj = { tag: "s12." + p0.n, n: p0.n + 7, a: null, b: null };
  return t15;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  p1.b = p1;
  const r20 = h7(p0, p1, p1, d);
  const t21 = bag.get(p1.n % 5) ?? null;
  if (r20 !== null) {
    p0.n += 5;
  }
  const r22 = h6(p1, d);
  const l23 = [p1, p0];
  l23[0].b = p0;
  const r24 = f0(p1);
  if (p0.n % 61 === 24) throw p1;
  return t21;
}
function h6(p0: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  bag.set(p0.n % 5, p0);
  try {
    p0.b = null;
    if (p0.n % 37 === 5) throw p0;
  } finally {
    if (p0.n % 61 === 16) slot = p0;
  }
  return { tag: "s15." + p0.n, n: p0.n + 1, a: null, b: null };
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const l25 = [p0, p0];
  l25[0].a = p0;
  bag.set(p0.n % 5, p0);
  if (p2 === p1) p2.n += 1000;
  return { tag: "s16." + p2.n, n: p2.n + 2, a: p0, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h7(o2, o2, o1, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 29) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h7(o2, o0, { tag: "s17." + o0.n, n: o0.n + 7, a: o0, b: null }, 1);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 71 === 27) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h7(o2, o1, o0, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 4) kept.push(r28);
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
