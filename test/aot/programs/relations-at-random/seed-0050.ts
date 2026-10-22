// Made by test/aot/generate-relations-at-random.ts, seed 50: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const l0 = [p0, p0];
  l0[0].b = p0;
  const c1 = p0.n % 2 === 0 ? p0 : p0;
  const t2 = slot;
  return c1;
}
function h1(p0: Obj, f0: Fn, d: number): Obj | null {
  const t3 = slot;
  bag.set(p0.n % 5, p0);
  const c4 = p0.n % 2 === 0 ? p0 : p0;
  const w5: Obj = new Made("c1." + c4.n, c4.n + 1, p0);
  w5.a!.b = p0;
  c4.a = p0;
  if (p0.n % 37 === 24) keptFunctions.push(f0);
  return p0;
}
function h2(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t6 = holder.take();
  if (p1.n % 89 === 19) keptFunctions.push(f0);
  const t7 = bag.get(p1.n % 5) ?? null;
  const t8 = bag.get(p0.n % 5) ?? null;
  const r9 = d > 0 ? h2(p1, { tag: "s3." + p1.n, n: p1.n + 2, a: p1, b: null }, p1, f0, d - 1) : null;
  if (p1.n % 41 === 23) holder.hold(p1);
  return t6;
}
function h3(p0: Obj, d: number): Obj | null {
  if (p0 === p0) p0.n += 1000;
  const l10 = [p0, p0];
  l10[1].a = p0;
  bag.set(p0.n % 5, p0);
  const g11 = (v: Obj): Obj | null => {
    p0.a = null;
    v.b = v;
    return p0;
  };
  if (p0.n % 41 === 21) keptFunctions.push(g11);
  return p0;
}
function h4(p0: Obj, f0: Fn, d: number): Obj | null {
  const r12 = h5(p0, (v: Obj): Obj | null => {
    if (p0.n % 37 === 5) slot = v;
    v.b = p0;
    return v;
  }, d);
  const t13 = bag.get(p0.n % 5) ?? null;
  let r14: Obj | null = null;
  try {
    r14 = h5(p0, (v: Obj): Obj | null => {
      p0.a = v;
      p0.a = p0;
      p0.a = p0;
      return v;
    }, d);
  } catch (e) {
    r14 = e as Obj;
  }
  const t15 = holder.take();
  const t16 = slot;
  return t13;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const o17: Obj = new Made("c10." + p0.n, p0.n + 2, p0);
  const c18 = p0.n % 2 === 0 ? p0 : p0;
  for (const v of both(o17, o17)) {
    if (p0.n % 41 === 8) slot = p0;
  }
  return c18;
}
function h6(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const c19 = p0.n % 2 === 0 ? p0 : p1;
  if (c19.n % 61 === 16) keptFunctions.push(f0);
  const w20: Obj = new Made("c12." + p1.n, p1.n + 9, c19);
  w20.a!.a = p2;
  const t21 = c19.b;
  return { tag: "s13." + p0.n, n: p0.n + 2, a: p2, b: null };
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const o22: Obj = { tag: "s14." + p1.n, n: p1.n + 9, a: p2, b: null };
  if (p2.n % 41 === 2) throw p2;
  const g23 = first.bind(null, p1);
  const t24 = p1.b;
  const r25 = g23(p0);
  const t26 = holder.take();
  return { tag: "s15." + o22.n, n: o22.n + 4, a: p2, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r27 = h2(o0, { tag: "s16." + o1.n, n: o1.n + 4, a: o1, b: null }, new Made("c17." + o2.n, o2.n + 5, o2), (v: Obj): Obj | null => {
      o0.n += 1;
      return o0;
    }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 37 === 20) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h0(o1, (v: Obj): Obj | null => {
      if (o2 === o0) o2.n += 1000;
      v.a = o2;
      return o0;
    }, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 53 === 22) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h6({ tag: "s20." + o1.n, n: o1.n + 7, a: o1, b: null }, { tag: "s21." + o1.n, n: o1.n + 7, a: null, b: null }, o2, (v: Obj): Obj | null => {
      if (o1.n % 37 === 11) slot = o1;
      return v;
    }, 1);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 71 === 13) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h5(o1, (v: Obj): Obj | null => {
      o2.b = null;
      return o2;
    }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 53 === 14) kept.push(r30);
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
