// Made by test/aot/generate-relations-at-random.ts, seed 2: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = h2({ tag: "s0." + p0.n, n: p0.n + 9, a: p0, b: null }, new Made("c1." + p0.n, p0.n + 5, p0), d);
  const g1 = first.bind(null, p0);
  try {
    p0.n += 1;
    if (p0.n % 61 === 1) throw p0;
  } finally {
    if (p0.n % 53 === 28) slot = p0;
  }
  return null;
}
function h1(p0: Obj, p1: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p1);
  const r2 = h8.apply(null, [p0, { tag: "s3." + p1.n, n: p1.n + 8, a: p0, b: null }, d]);
  const r3 = d > 0 ? h1(p1, p1, d - 1) : null;
  const t4 = slot;
  const g5 = (v: Obj): Obj | null => {
    if (p0.n % 41 === 11) kept.push(v);
    v.a = null;
    p0.b = v;
    return p1;
  };
  const r6 = h7(p1, d);
  return t4;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const l7 = [p1, p1];
  l7[1].a = p1;
  p0.n += 2;
  p1.a = p0;
  try {
    if (p0.n % 41 === 22) kept.push(p1);
    if (p1.n % 89 === 11) throw p0;
  } finally {
    p0.a = null;
  }
  const r8 = h6.apply(null, [p0, p0, { tag: "s6." + p0.n, n: p0.n + 3, a: null, b: null }, d]);
  if (r8 !== null) {
    if (r8.n % 41 === 25) slot = p1;
  }
  return p0;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  if (p0.n % 89 === 17) throw p0;
  let c9 = p1;
  for (let k = 0; k < 3; k++) c9 = c9.a ?? p0;
  const o10: Obj = { tag: "s8." + p0.n, n: p0.n + 5, a: c9, b: null };
  let c11 = o10;
  for (let k = 0; k < 3; k++) c11 = c11.b ?? p0;
  return o10;
}
function h4(p0: Obj, d: number): Obj | null {
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.a ?? p0;
  let c13 = p0;
  for (let k = 0; k < 3; k++) c13 = c13.a ?? p0;
  const r14 = d > 0 ? h4({ tag: "s10." + c12.n, n: c12.n + 4, a: null, b: null }, d - 1) : null;
  let r15: Obj | null = null;
  try {
    r15 = h5(c13, d);
  } catch (e) {
    r15 = e as Obj;
  }
  c13.b = null;
  let r16: Obj | null = null;
  try {
    r16 = h5(c13, d);
  } catch (e) {
    r16 = e as Obj;
  }
  return r15;
}
function h5(p0: Obj, d: number): Obj | null {
  const r17 = d > 0 ? h5(p0, d - 1) : null;
  const c18 = p0.n % 2 === 0 ? p0 : p0;
  const w19: Obj = { tag: "s12." + c18.n, n: c18.n + 9, a: p0, b: null };
  w19.a!.a = p0;
  let r20: Obj | null = null;
  try {
    r20 = h8(p0, c18, d);
  } catch (e) {
    r20 = e as Obj;
  }
  const o21: Obj = { tag: "s13." + c18.n, n: c18.n + 5, a: null, b: null };
  return o21;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p0.n % 61 === 0) throw p1;
  const r22 = h8.apply(null, [p0, { tag: "s15." + p0.n, n: p0.n + 3, a: null, b: null }, d]);
  const l23 = [p0, p1];
  l23[0].a = p1;
  bag.set(p0.n % 5, p2);
  return p1;
}
function h7(p0: Obj, d: number): Obj | null {
  bag.set(p0.n % 5, p0);
  const c24 = p0.n % 2 === 0 ? p0 : p0;
  bag.set(p0.n % 5, c24);
  return { tag: "s17." + p0.n, n: p0.n + 2, a: c24, b: null };
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  let c25 = p1;
  for (let k = 0; k < 3; k++) c25 = c25.a ?? p1;
  const g26 = (v: Obj): Obj | null => {
    c25.a = v;
    return v;
  };
  return c25;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r27 = h2(o2, o2, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 41 === 6) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h1(o1, o2, 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 89 === 20) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h4(o0, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 53 === 9) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h8(o2, new Made("c20." + o1.n, o1.n + 9, o1), 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 22) kept.push(r30);
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
