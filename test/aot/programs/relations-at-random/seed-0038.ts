// Made by test/aot/generate-relations-at-random.ts, seed 38: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r0 = f0(p2);
  const g1 = (v: Obj): Obj | null => {
    if (v.n % 61 === 28) slot = v;
    if (v.n % 53 === 16) kept.push(v);
    if (p0 === p0) p0.n += 1000;
    return v;
  };
  let r2: Obj | null = null;
  try {
    r2 = h6(p2, p2, d);
  } catch (e) {
    r2 = e as Obj;
  }
  let r3: Obj | null = null;
  try {
    r3 = h7(p0, p0, p0, (v: Obj): Obj | null => {
      p2.a = null;
      p0.a = null;
      return p0;
    }, d);
  } catch (e) {
    r3 = e as Obj;
  }
  const t4 = holder.take();
  for (const v of both(p0, p1)) {
    p0.b = p2;
  }
  return null;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const o5: Obj = new Made("c3." + p0.n, p0.n + 6, p1);
  const r6 = d > 0 ? h1(p1, p0, { tag: "s4." + p2.n, n: p2.n + 6, a: o5, b: null }, d - 1) : null;
  try {
    if (p0.n % 53 === 12) slot = o5;
    if (p2.n % 61 === 9) throw o5;
  } finally {
    p0.a = p2;
  }
  return null;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  bag.set(p1.n % 5, p0);
  p1.n += 2;
  const g7 = first.bind(null, p0);
  const l8 = [p0, p1];
  l8[0].b = p1;
  for (const v of both(p1, p0)) {
    if (p1 === p1) p1.n += 1000;
  }
  return new Made("c6." + p1.n, p1.n + 8, p1);
}
function h3(p0: Obj, d: number): Obj | null {
  const t9 = bag.get(p0.n % 5) ?? null;
  bag.set(p0.n % 5, p0);
  const g10 = first.bind(null, p0);
  try {
    if (p0.n % 53 === 7) slot = p0;
    if (p0.n % 41 === 4) throw p0;
  } finally {
    p0.n += 2;
  }
  const g11 = first.bind(null, p0);
  for (const v of both(p0, p0)) {
    if (p0 === v) p0.n += 1000;
  }
  return p0;
}
function h4(p0: Obj, d: number): Obj | null {
  let r12: Obj | null = null;
  try {
    r12 = h8({ tag: "s8." + p0.n, n: p0.n + 2, a: null, b: null }, p0, p0, d);
  } catch (e) {
    r12 = e as Obj;
  }
  const w13: Obj = { tag: "s9." + p0.n, n: p0.n + 1, a: p0, b: null };
  w13.a!.b = p0;
  const t14 = slot;
  for (const v of both(p0, p0)) {
    if (v.n % 37 === 5) slot = p0;
  }
  if (p0.n % 61 === 16) kept.push(p0);
  return t14;
}
function h5(p0: Obj, d: number): Obj | null {
  const r15 = h6(p0, p0, d);
  const g16 = (v: Obj): Obj | null => {
    v.a = v;
    return { tag: "s11." + v.n, n: v.n + 1, a: p0, b: null };
  };
  const r17 = d > 0 ? h5({ tag: "s12." + p0.n, n: p0.n + 5, a: p0, b: null }, d - 1) : null;
  const o18: Obj = { tag: "s13." + p0.n, n: p0.n + 6, a: null, b: null };
  return o18;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const t19 = slot;
  const r20 = d > 0 ? h6(p0, p1, d - 1) : null;
  const l21 = [p1, p1];
  l21[1].b = p0;
  return p0;
}
function h7(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t22 = p0.a;
  p2.n += 1;
  let c23 = p2;
  for (let k = 0; k < 3; k++) c23 = c23.a ?? p1;
  const g24 = first.bind(null, p0);
  const t25 = holder.take();
  if (t22 !== null) {
    p0.n += 1;
  }
  try {
    if (p2.n % 89 === 27) kept.push(c23);
    if (p1.n % 61 === 21) throw p0;
  } finally {
    p2.a = null;
  }
  return { tag: "s16." + p0.n, n: p0.n + 9, a: c23, b: null };
}
function h8(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t26 = p0.b;
  try {
    p2.a = p1;
    if (p2.n % 71 === 0) throw p2;
  } finally {
    p0.a = p2;
  }
  if (p0.n % 31 === 11) kept.push(p0);
  const t27 = holder.take();
  const w28: Obj = { tag: "s17." + p2.n, n: p2.n + 7, a: p0, b: null };
  w28.a!.b = p0;
  return p2;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h5(o0, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 31 === 28) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h8(o0, { tag: "s19." + o1.n, n: o1.n + 4, a: o2, b: null }, o1, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 89 === 7) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h8(o2, { tag: "s20." + o1.n, n: o1.n + 5, a: null, b: null }, o0, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 61 === 14) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h8(o0, o0, o2, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 53 === 23) kept.push(r32);
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
