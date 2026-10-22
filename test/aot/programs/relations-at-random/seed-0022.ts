// Made by test/aot/generate-relations-at-random.ts, seed 22: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  let c0 = p0;
  for (let k = 0; k < 3; k++) c0 = c0.a ?? p0;
  const c1 = p0.n % 2 === 0 ? p0 : p0;
  const r2 = f0(c0);
  if (r2 !== null) {
    if (c0.n % 41 === 3) kept.push(p0);
  }
  if (r2 !== null) {
    c1.b = p0;
  }
  const r3 = d > 0 ? h0(c1, f0, d - 1) : null;
  return null;
}
function h1(p0: Obj, f0: Fn, d: number): Obj | null {
  const r4 = h4(p0, f0, d);
  const t5 = bag.get(p0.n % 5) ?? null;
  const t6 = p0.b;
  const g7 = (v: Obj): Obj | null => {
    v.n += 1;
    return { tag: "s1." + v.n, n: v.n + 6, a: null, b: null };
  };
  let r8: Obj | null = null;
  try {
    r8 = h5({ tag: "s2." + p0.n, n: p0.n + 5, a: p0, b: null }, g7, d);
  } catch (e) {
    r8 = e as Obj;
  }
  if (t6 !== null) {
    p0.n += 4;
  }
  return t6;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const r9 = h6.call(null, p1, p1, (v: Obj): Obj | null => {
    p0.n += 3;
    if (p2 === p2) p2.n += 1000;
    p2.n += 2;
    return null;
  }, d);
  bag.set(p1.n % 5, p1);
  const r10 = h4.call(null, p0, (v: Obj): Obj | null => {
    p0.a = v;
    v.b = null;
    return p0;
  }, d);
  const t11 = p1.a;
  return r10;
}
function h3(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  let r12: Obj | null = null;
  try {
    r12 = h6({ tag: "s7." + p0.n, n: p0.n + 3, a: p0, b: null }, { tag: "s8." + p2.n, n: p2.n + 8, a: p2, b: null }, (v: Obj): Obj | null => {
      v.b = p0;
      return p0;
    }, d);
  } catch (e) {
    r12 = e as Obj;
  }
  const r13 = h5.apply(null, [p2, (v: Obj): Obj | null => {
    v.b = p2;
    p1.b = null;
    if (p2 === p2) p2.n += 1000;
    return null;
  }, d]);
  p2.n += 5;
  const c14 = p1.n % 2 === 0 ? p1 : p0;
  const o15: Obj = new Made("c11." + c14.n, c14.n + 8, p1);
  return p1;
}
function h4(p0: Obj, f0: Fn, d: number): Obj | null {
  const c16 = p0.n % 2 === 0 ? p0 : p0;
  const w17: Obj = new Made("c13." + c16.n, c16.n + 4, c16);
  w17.a!.b = p0;
  if (c16.n % 31 === 12) keptFunctions.push(f0);
  c16.a = c16;
  const g18 = first.bind(null, c16);
  const t19 = bag.get(p0.n % 5) ?? null;
  return t19;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const r20 = f0(p0);
  const r21 = d > 0 ? h5(p0, (v: Obj): Obj | null => {
    p0.b = null;
    return p0;
  }, d - 1) : null;
  const t22 = bag.get(p0.n % 5) ?? null;
  if (p0.n % 41 === 27) holder.hold(p0);
  return { tag: "s16." + p0.n, n: p0.n + 4, a: null, b: null };
}
function h6(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  if (p1 === p0) p1.n += 1000;
  const t23 = bag.get(p0.n % 5) ?? null;
  const r24 = d > 0 ? h6(p1, p0, (v: Obj): Obj | null => {
    if (p1.n % 61 === 22) kept.push(p0);
    p1.b = null;
    if (v.n % 89 === 18) slot = p1;
    return v;
  }, d - 1) : null;
  const t25 = p1.b;
  let r26: Obj | null = null;
  try {
    r26 = h8({ tag: "s18." + p0.n, n: p0.n + 1, a: p0, b: null }, p0, d);
  } catch (e) {
    r26 = e as Obj;
  }
  const r27 = h7(p0, p0, f0, d);
  try {
    p1.n += 5;
    if (p1.n % 31 === 26) throw p1;
  } finally {
    p1.b = null;
  }
  return t25;
}
function h7(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const o28: Obj = new Made("c20." + p0.n, p0.n + 3, p1);
  const t29 = slot;
  const r30 = f0(p0);
  if (r30 !== null) {
    p0.a = o28;
  }
  bag.set(p1.n % 5, o28);
  return p1;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const w31: Obj = { tag: "s22." + p1.n, n: p1.n + 9, a: p1, b: null };
  w31.a!.b = p1;
  for (const v of both(p0, p0)) {
    v.n += 2;
  }
  let c32 = p1;
  for (let k = 0; k < 3; k++) c32 = c32.b ?? p1;
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r33 = h3(o0, new Made("c24." + o0.n, o0.n + 6, null), o1, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 27) kept.push(r33);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r34 = h3(o2, o2, { tag: "s25." + o2.n, n: o2.n + 1, a: o1, b: null }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 37 === 21) kept.push(r34);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r35 = h1(o2, (v: Obj): Obj | null => {
      v.n += 5;
      o0.n += 5;
      return o2;
    }, 0);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 89 === 29) kept.push(r35);
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
