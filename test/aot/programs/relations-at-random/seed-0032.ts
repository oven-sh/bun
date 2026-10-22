// Made by test/aot/generate-relations-at-random.ts, seed 32: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  let c0 = p0;
  for (let k = 0; k < 3; k++) c0 = c0.b ?? p0;
  const r1 = h6(p0, p1, c0, d);
  const l2 = [c0, p0];
  l2[1].b = p2;
  if (r1 !== null) {
    if (p1.n % 61 === 2) slot = p2;
  }
  return r1;
}
function h1(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  for (const v of both(p0, p1)) {
    v.a = p1;
  }
  holder.hold(p0);
  p0.n += 2;
  const r3 = h3(p1, { tag: "s1." + p0.n, n: p0.n + 6, a: null, b: null }, d);
  const t4 = slot;
  return p0;
}
function h2(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r5 = h5({ tag: "s3." + p0.n, n: p0.n + 1, a: p0, b: null }, (v: Obj): Obj | null => {
    if (v === v) v.n += 1000;
    if (v.n % 37 === 12) kept.push(p1);
    if (v.n % 61 === 1) kept.push(p1);
    return p1;
  }, d);
  if (p1.n % 71 === 4) holder.hold(p1);
  const g6 = (v: Obj): Obj | null => {
    if (p1.n % 89 === 19) slot = p1;
    if (p1.n % 61 === 8) kept.push(p0);
    if (p1 === p0) p1.n += 1000;
    return p1;
  };
  const { a: t7 } = p1;
  return r5;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  try {
    p0.n += 1;
    if (p1.n % 71 === 7) throw p1;
  } finally {
    if (p0.n % 37 === 16) kept.push(p0);
  }
  p1.b = p0;
  return null;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const l8 = [p2, p2];
  l8[0].b = p2;
  if (p2.n % 89 === 23) holder.hold(p0);
  try {
    p2.n += 4;
    if (p2.n % 61 === 21) throw p2;
  } finally {
    p1.a = p0;
  }
  try {
    p0.n += 2;
    if (p1.n % 31 === 29) throw p2;
  } finally {
    p0.b = null;
  }
  const r9 = f0(p0);
  return p1;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const t10 = p0.b;
  const g11 = (v: Obj): Obj | null => {
    v.n += 5;
    p0.n += 1;
    if (v === v) v.n += 1000;
    return v;
  };
  const t12 = bag.get(p0.n % 5) ?? null;
  const w13: Obj = { tag: "s10." + p0.n, n: p0.n + 7, a: p0, b: null };
  w13.a!.a = p0;
  return t10;
}
function h6(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  try {
    p0.a = p1;
    if (p2.n % 41 === 18) throw p0;
  } finally {
    p0.a = p1;
  }
  const t14 = slot;
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r15 = h6(o0, o1, o0, 2);
    if (r15 !== null) {
      sum += r15.n;
      if (r15.n % 31 === 28) kept.push(r15);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r16 = h1(o0, { tag: "s13." + o0.n, n: o0.n + 5, a: null, b: null }, o0, 0);
    if (r16 !== null) {
      sum += r16.n;
      if (r16.n % 41 === 21) kept.push(r16);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r17 = h5(o1, (v: Obj): Obj | null => {
      o1.b = o0;
      return null;
    }, 0);
    if (r17 !== null) {
      sum += r17.n;
      if (r17.n % 71 === 13) kept.push(r17);
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
