// Made by test/aot/generate-relations-at-random.ts, seed 78: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const w0: Obj = { tag: "s0." + p0.n, n: p0.n + 6, a: p0, b: null };
  w0.a!.a = p0;
  try {
    if (p0.n % 89 === 9) slot = p0;
    if (p0.n % 71 === 25) throw p0;
  } finally {
    p0.n += 3;
  }
  const t1 = slot;
  if (p0 === p0) p0.n += 1000;
  return null;
}
function h1(p0: Obj, p1: Obj, d: number): Obj | null {
  const r2 = h5({ tag: "s2." + p1.n, n: p1.n + 9, a: null, b: null }, d);
  const t3 = p0.a;
  if (r2 !== null) {
    r2.b = null;
  }
  return p1;
}
function h2(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const o4: Obj = { tag: "s4." + p2.n, n: p2.n + 3, a: p0, b: null };
  const g5 = (v: Obj): Obj | null => {
    if (o4.n % 37 === 8) slot = p0;
    p0.b = null;
    v.b = null;
    return null;
  };
  for (const v of both(p1, o4)) {
    v.b = p0;
  }
  return new Made("c6." + p1.n, p1.n + 7, p1);
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  const r6 = h6(new Made("c7." + p0.n, p0.n + 5, p1), p1, p1, d);
  if (r6 !== null) {
    if (p1.n % 31 === 28) kept.push(p0);
  }
  try {
    if (p0.n % 61 === 27) slot = p0;
    if (p1.n % 41 === 28) throw p0;
  } finally {
    if (p1.n % 41 === 0) slot = p0;
  }
  return p0;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  let r7: Obj | null = null;
  try {
    r7 = h5({ tag: "s9." + p1.n, n: p1.n + 4, a: p1, b: null }, d);
  } catch (e) {
    r7 = e as Obj;
  }
  const t8 = slot;
  holder.hold(p2);
  return null;
}
function h5(p0: Obj, d: number): Obj | null {
  const g9 = first.bind(null, p0);
  const l10 = [p0, p0];
  l10[0].b = p0;
  const w11: Obj = { tag: "s11." + p0.n, n: p0.n + 1, a: p0, b: null };
  w11.a!.b = p0;
  const g12 = first.bind(null, p0);
  const r13 = h6(new Made("c12." + p0.n, p0.n + 7, null), p0, p0, d);
  holder.hold(p0);
  try {
    if (p0.n % 61 === 20) slot = p0;
    if (p0.n % 61 === 13) throw p0;
  } finally {
    if (p0.n % 37 === 20) kept.push(p0);
  }
  return new Made("c13." + p0.n, p0.n + 8, null);
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1.n % 89 === 22) slot = p2;
  const r14 = h7.apply(null, [{ tag: "s14." + p2.n, n: p2.n + 6, a: p0, b: null }, d]);
  const r15 = h7.apply(null, [{ tag: "s15." + p0.n, n: p0.n + 8, a: p2, b: null }, d]);
  const r16 = h7(p0, d);
  const r17 = h7(p0, d);
  if (r15 !== null) {
    if (p0.n % 71 === 19) slot = p2;
  }
  return { tag: "s16." + p2.n, n: p2.n + 1, a: p2, b: null };
}
function h7(p0: Obj, d: number): Obj | null {
  const o18: Obj = new Made("c17." + p0.n, p0.n + 3, p0);
  const w19: Obj = new Made("c18." + o18.n, o18.n + 5, p0);
  w19.a!.a = p0;
  const t20 = holder.take();
  holder.hold(o18);
  return p0;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h1(o0, { tag: "s20." + o0.n, n: o0.n + 1, a: o2, b: null }, 1);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 53 === 28) kept.push(r21);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r22 = h5(o2, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 53 === 2) kept.push(r22);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r23 = h4(o0, o0, { tag: "s21." + o2.n, n: o2.n + 6, a: o1, b: null }, (v: Obj): Obj | null => {
      o1.a = o0;
      if (o2.n % 31 === 13) kept.push(o0);
      if (o2 === o2) o2.n += 1000;
      return v;
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 41 === 26) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h4(o2, o2, o2, (v: Obj): Obj | null => {
      o1.n += 5;
      if (o1.n % 31 === 16) slot = v;
      return o1;
    }, 2);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 61 === 23) kept.push(r24);
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
