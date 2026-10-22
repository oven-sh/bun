// Made by test/aot/generate-relations-at-random.ts, seed 4: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = (v: Obj): Obj | null => {
    v.n += 1;
    if (p0.n % 31 === 24) slot = v;
    p0.n += 1;
    return p0;
  };
  const r1 = h4.apply(null, [new Made("c1." + p0.n, p0.n + 7, p0), p0, p0, d]);
  const g2 = (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    p0.n += 4;
    v.n += 4;
    return v;
  };
  const g3 = first.bind(null, p0);
  try {
    p0.a = null;
    if (p0.n % 31 === 2) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  return r1;
}
function h1(p0: Obj, f0: Fn, d: number): Obj | null {
  const r4 = f0(p0);
  const t5 = bag.get(p0.n % 5) ?? null;
  const o6: Obj = { tag: "s4." + p0.n, n: p0.n + 2, a: null, b: null };
  if (p0.n % 89 === 27) throw o6;
  let r7: Obj | null = null;
  try {
    r7 = h9(p0, p0, o6, d);
  } catch (e) {
    r7 = e as Obj;
  }
  return o6;
}
function h2(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const o8: Obj = new Made("c6." + p1.n, p1.n + 8, null);
  const c9 = p0.n % 2 === 0 ? p0 : p1;
  const l10 = [p0, c9];
  l10[1].b = c9;
  const w11: Obj = { tag: "s7." + c9.n, n: c9.n + 6, a: p1, b: null };
  w11.a!.a = p1;
  const c12 = p1.n % 2 === 0 ? p1 : o8;
  if (c9.n % 61 === 5) holder.hold(p0);
  let r13: Obj | null = null;
  try {
    r13 = h5(c12, c9, d);
  } catch (e) {
    r13 = e as Obj;
  }
  const r14 = h5(p0, { tag: "s8." + p0.n, n: p0.n + 6, a: p0, b: null }, d);
  return r13;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g15 = first.bind(null, p0);
  const r16 = h9(p2, p2, p2, d);
  try {
    p0.b = null;
    if (p2.n % 71 === 18) throw p2;
  } finally {
    if (p2.n % 71 === 20) slot = p0;
  }
  return p1;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g17 = first.bind(null, p2);
  const r18 = h9(p1, p2, p1, d);
  const t19 = p2.b;
  const t20 = slot;
  const w21: Obj = { tag: "s11." + p0.n, n: p0.n + 8, a: p0, b: null };
  w21.a!.b = p0;
  return p0;
}
function h5(p0: Obj, p1: Obj, d: number): Obj | null {
  holder.hold(p1);
  if (p1.n % 37 === 10) throw p0;
  const r22 = h7(p1, p1, p1, d);
  let c23 = p1;
  for (let k = 0; k < 3; k++) c23 = c23.b ?? p1;
  const t24 = c23.a;
  const t25 = slot;
  if (r22 !== null) {
    r22.a = null;
  }
  if (c23.n % 31 === 29) slot = c23;
  return r22;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1 === p1) p1.n += 1000;
  try {
    p0.a = p2;
    if (p0.n % 89 === 27) throw p1;
  } finally {
    p0.n += 5;
  }
  const t26 = bag.get(p0.n % 5) ?? null;
  const g27 = (v: Obj): Obj | null => {
    p1.a = p1;
    return v;
  };
  bag.set(p0.n % 5, p1);
  return { tag: "s15." + p2.n, n: p2.n + 1, a: null, b: null };
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r28 = h9(p2, { tag: "s16." + p2.n, n: p2.n + 7, a: p1, b: null }, p1, d);
  if (p0.n % 61 === 3) throw p0;
  const t29 = holder.take();
  let c30 = p0;
  for (let k = 0; k < 3; k++) c30 = c30.a ?? p2;
  let r31: Obj | null = null;
  try {
    r31 = h8(p1, p0, d);
  } catch (e) {
    r31 = e as Obj;
  }
  let c32 = p2;
  for (let k = 0; k < 3; k++) c32 = c32.b ?? p1;
  if (c32.n % 71 === 24) kept.push(p0);
  return { tag: "s17." + p1.n, n: p1.n + 2, a: c32, b: null };
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const o33: Obj = { tag: "s18." + p1.n, n: p1.n + 7, a: p0, b: null };
  const w34: Obj = new Made("c19." + p1.n, p1.n + 7, p1);
  w34.a!.a = p1;
  holder.hold(o33);
  bag.set(o33.n % 5, p0);
  return new Made("c20." + o33.n, o33.n + 5, o33);
}
function h9(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1.n % 89 === 1) slot = p2;
  const { b: t35 } = p0;
  const g36 = first.bind(null, p0);
  return p1;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r37 = h0(o0, (v: Obj): Obj | null => {
      o0.b = o0;
      o0.a = v;
      v.n += 2;
      return o1;
    }, 0);
    if (r37 !== null) {
      sum += r37.n;
      if (r37.n % 41 === 9) kept.push(r37);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r38 = h7(o0, o0, o0, 0);
    if (r38 !== null) {
      sum += r38.n;
      if (r38.n % 61 === 8) kept.push(r38);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r39 = h5({ tag: "s23." + o1.n, n: o1.n + 4, a: o0, b: null }, new Made("c24." + o2.n, o2.n + 4, o0), 1);
    if (r39 !== null) {
      sum += r39.n;
      if (r39.n % 71 === 9) kept.push(r39);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r40 = h2(o1, o2, (v: Obj): Obj | null => {
      o2.b = v;
      if (o2.n % 41 === 28) kept.push(o2);
      if (o0 === o2) o0.n += 1000;
      return null;
    }, 2);
    if (r40 !== null) {
      sum += r40.n;
      if (r40.n % 61 === 1) kept.push(r40);
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
