// Made by test/aot/generate-relations-at-random.ts, seed 68: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = f0(p0);
  const t1 = holder.take();
  try {
    p0.n += 5;
    if (p0.n % 89 === 24) throw p0;
  } finally {
    p0.n += 4;
  }
  const { b: t2 } = p0;
  return p0;
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t3 = holder.take();
  bag.set(p0.n % 5, p0);
  try {
    if (p2.n % 31 === 24) kept.push(p2);
    if (p0.n % 41 === 28) throw p1;
  } finally {
    p1.b = p2;
  }
  const r4 = h3({ tag: "s1." + p2.n, n: p2.n + 3, a: p2, b: null }, p0, p2, d);
  const o5: Obj = { tag: "s2." + p0.n, n: p0.n + 4, a: p1, b: null };
  if (r4 !== null) {
    if (o5.n % 89 === 0) kept.push(p2);
  }
  const l6 = [p1, o5];
  l6[1].b = p2;
  const t7 = bag.get(p2.n % 5) ?? null;
  return o5;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const g8 = (v: Obj): Obj | null => {
    if (p1.n % 61 === 21) slot = p0;
    if (v === p0) v.n += 1000;
    return p0;
  };
  const r9 = h6(p1, p1, d);
  const t10 = slot;
  for (const v of both(p0, p0)) {
    v.b = null;
  }
  const t11 = holder.take();
  return p0;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const o12: Obj = { tag: "s6." + p1.n, n: p1.n + 4, a: null, b: null };
  for (const v of both(p2, p0)) {
    if (o12.n % 31 === 6) slot = p1;
  }
  const c13 = o12.n % 2 === 0 ? o12 : o12;
  return p2;
}
function h4(p0: Obj, p1: Obj, d: number): Obj | null {
  let c14 = p1;
  for (let k = 0; k < 3; k++) c14 = c14.a ?? p0;
  if (p1.n % 53 === 7) throw p1;
  const o15: Obj = new Made("c8." + c14.n, c14.n + 4, c14);
  bag.set(p1.n % 5, o15);
  const r16 = h5.apply(null, [o15, d]);
  const r17 = h5(c14, d);
  holder.hold(p0);
  return { tag: "s9." + o15.n, n: o15.n + 1, a: o15, b: null };
}
function h5(p0: Obj, d: number): Obj | null {
  const r18 = h6.apply(null, [new Made("c10." + p0.n, p0.n + 4, null), p0, d]);
  const r19 = h6(p0, new Made("c11." + p0.n, p0.n + 2, null), d);
  if (p0 === p0) p0.n += 1000;
  const l20 = [p0, p0];
  l20[0].a = p0;
  return r18;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const g21 = (v: Obj): Obj | null => {
    p0.a = p0;
    return v;
  };
  const r22 = d > 0 ? h6(p1, { tag: "s14." + p0.n, n: p0.n + 3, a: p1, b: null }, d - 1) : null;
  return { tag: "s15." + p1.n, n: p1.n + 7, a: p0, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r23 = h6(o0, o2, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 61 === 7) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h4(o0, o0, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 71 === 10) kept.push(r24);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r25 = h5(o0, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 61 === 12) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h5(new Made("c16." + o2.n, o2.n + 9, null), 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 41 === 22) kept.push(r26);
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
