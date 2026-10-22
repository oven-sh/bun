// Made by test/aot/generate-relations-at-random.ts, seed 64: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  try {
    if (p0.n % 71 === 3) slot = p1;
    if (p1.n % 53 === 2) throw p0;
  } finally {
    if (p0.n % 89 === 6) kept.push(p0);
  }
  holder.hold(p0);
  let r0: Obj | null = null;
  try {
    r0 = h2({ tag: "s0." + p0.n, n: p0.n + 5, a: p0, b: null }, { tag: "s1." + p0.n, n: p0.n + 9, a: null, b: null }, { tag: "s2." + p0.n, n: p0.n + 2, a: p1, b: null }, d);
  } catch (e) {
    r0 = e as Obj;
  }
  let r1: Obj | null = null;
  try {
    r1 = h5(new Made("c3." + p1.n, p1.n + 9, null), p1, { tag: "s4." + p0.n, n: p0.n + 7, a: p1, b: null }, (v: Obj): Obj | null => {
      if (v.n % 61 === 8) kept.push(p1);
      v.a = v;
      return p1;
    }, d);
  } catch (e) {
    r1 = e as Obj;
  }
  for (const v of both(p0, p1)) {
    if (p1 === p0) p1.n += 1000;
  }
  return { tag: "s6." + p0.n, n: p0.n + 2, a: null, b: null };
}
function h1(p0: Obj, d: number): Obj | null {
  const t2 = holder.take();
  const g3 = (v: Obj): Obj | null => {
    if (v.n % 71 === 19) slot = v;
    p0.b = v;
    return v;
  };
  const t4 = p0.b;
  return null;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  holder.hold(p1);
  const t5 = bag.get(p0.n % 5) ?? null;
  const r6 = h9.apply(null, [p0, p0, d]);
  return null;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  if (p0 === p1) p0.n += 1000;
  const w7: Obj = new Made("c10." + p0.n, p0.n + 1, p1);
  w7.a!.b = p0;
  bag.set(p0.n % 5, p1);
  const c8 = p0.n % 2 === 0 ? p0 : p1;
  if (c8.n % 41 === 21) throw p1;
  const t9 = slot;
  if (c8.n % 89 === 16) throw p0;
  return p0;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  const r10 = h7(p1, p1, p1, (v: Obj): Obj | null => {
    if (v.n % 61 === 27) kept.push(v);
    if (v === p1) v.n += 1000;
    if (p1 === p0) p1.n += 1000;
    return v;
  }, d);
  if (r10 !== null) {
    p1.b = null;
  }
  try {
    p1.a = p1;
    if (p1.n % 61 === 5) throw p0;
  } finally {
    if (p1.n % 71 === 11) kept.push(p1);
  }
  let c11 = p1;
  for (let k = 0; k < 3; k++) c11 = c11.a ?? p0;
  const t12 = slot;
  return t12;
}
function h5(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t13 = bag.get(p1.n % 5) ?? null;
  if (t13 !== null) {
    p0.a = p0;
  }
  try {
    if (p1.n % 89 === 19) kept.push(p0);
    if (p2.n % 53 === 15) throw p2;
  } finally {
    p2.n += 4;
  }
  const g14 = first.bind(null, p1);
  const c15 = p2.n % 2 === 0 ? p2 : p0;
  bag.set(p1.n % 5, p0);
  return null;
}
function h6(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r16 = h9(p1, p0, d);
  const l17 = [p1, p1];
  l17[0].b = p0;
  holder.hold(p1);
  const r18 = d > 0 ? h6(p1, p1, (v: Obj): Obj | null => {
    p1.n += 3;
    p0.b = p0;
    if (p1 === v) p1.n += 1000;
    return null;
  }, d - 1) : null;
  p1.a = p1;
  for (const v of both(p0, p0)) {
    p0.b = null;
  }
  const r19 = h7(p0, p1, p1, (v: Obj): Obj | null => {
    if (p1.n % 53 === 20) kept.push(p0);
    if (p0.n % 53 === 26) slot = p0;
    if (p0.n % 53 === 17) kept.push(v);
    return v;
  }, d);
  return r18;
}
function h7(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  if (p1.n % 37 === 1) kept.push(p2);
  p0.a = p1;
  if (p2.n % 37 === 26) kept.push(p0);
  p0.a = p2;
  holder.hold(p2);
  const t20 = bag.get(p2.n % 5) ?? null;
  return p1;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const t21 = bag.get(p1.n % 5) ?? null;
  holder.hold(p0);
  for (const v of both(p1, p0)) {
    p1.a = p0;
  }
  return p0;
}
function h9(p0: Obj, p1: Obj, d: number): Obj | null {
  bag.set(p1.n % 5, p1);
  const o22: Obj = { tag: "s20." + p0.n, n: p0.n + 9, a: null, b: null };
  const o23: Obj = { tag: "s21." + p0.n, n: p0.n + 9, a: p0, b: null };
  if (p1.n % 61 === 17) throw p0;
  try {
    o23.a = null;
    if (o22.n % 89 === 9) throw o22;
  } finally {
    p1.n += 2;
  }
  let c24 = o22;
  for (let k = 0; k < 3; k++) c24 = c24.a ?? o23;
  const g25 = (v: Obj): Obj | null => {
    if (o23 === p0) o23.n += 1000;
    p1.b = null;
    return v;
  };
  return o23;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h9(o1, o0, 1);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 1) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h1(o2, 1);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 89 === 23) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h1(o2, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 61 === 22) kept.push(r28);
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
