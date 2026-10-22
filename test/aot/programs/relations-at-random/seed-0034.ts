// Made by test/aot/generate-relations-at-random.ts, seed 34: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = first.bind(null, p0);
  if (p0.n % 61 === 29) kept.push(p1);
  const g1 = first.bind(null, p2);
  if (p1.n % 41 === 27) holder.hold(p1);
  return null;
}
function h1(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const g2 = (v: Obj): Obj | null => {
    p1.b = p1;
    return p0;
  };
  if (p0.n % 37 === 26) throw p0;
  if (p1.n % 71 === 6) holder.hold(p1);
  if (p0.n % 31 === 23) throw p1;
  return p1;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t3 = holder.take();
  if (p2.n % 89 === 26) kept.push(p1);
  if (p1.n % 71 === 23) holder.hold(p0);
  return { tag: "s3." + p0.n, n: p0.n + 1, a: null, b: null };
}
function h3(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r4 = h8(p2, { tag: "s4." + p0.n, n: p0.n + 5, a: p1, b: null }, (v: Obj): Obj | null => {
    v.b = null;
    return null;
  }, d);
  try {
    p2.b = null;
    if (p2.n % 37 === 3) throw p0;
  } finally {
    p2.a = p0;
  }
  let c5 = p1;
  for (let k = 0; k < 3; k++) c5 = c5.a ?? p0;
  const r6 = h8(c5, p0, f0, d);
  const r7 = f0(c5);
  if (r6 !== null) {
    p1.a = r6;
  }
  const { b: t8 } = p1;
  return p2;
}
function h4(p0: Obj, d: number): Obj | null {
  if (p0.n % 53 === 26) holder.hold(p0);
  const r9 = h7(p0, p0, d);
  const t10 = bag.get(p0.n % 5) ?? null;
  let c11 = p0;
  for (let k = 0; k < 3; k++) c11 = c11.b ?? p0;
  return p0;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  if (p0.n % 37 === 22) throw p0;
  holder.hold(p0);
  const t12 = slot;
  if (t12 !== null) {
    t12.a = null;
  }
  return p0;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const t13 = holder.take();
  let r14: Obj | null = null;
  try {
    r14 = h7(new Made("c9." + p0.n, p0.n + 7, p0), p0, d);
  } catch (e) {
    r14 = e as Obj;
  }
  const r15 = d > 0 ? h6({ tag: "s10." + p0.n, n: p0.n + 3, a: p0, b: null }, (v: Obj): Obj | null => {
    if (v === p0) v.n += 1000;
    return p0;
  }, d - 1) : null;
  const o16: Obj = { tag: "s12." + p0.n, n: p0.n + 5, a: null, b: null };
  return null;
}
function h7(p0: Obj, p1: Obj, d: number): Obj | null {
  if (p0.n % 31 === 5) throw p1;
  if (p0.n % 71 === 26) slot = p1;
  const c17 = p1.n % 2 === 0 ? p1 : p1;
  const r18 = h8.apply(null, [p0, c17, (v: Obj): Obj | null => {
    c17.b = null;
    return v;
  }, d]);
  const r19 = h8({ tag: "s15." + c17.n, n: c17.n + 3, a: c17, b: null }, c17, (v: Obj): Obj | null => {
    v.b = c17;
    return v;
  }, d);
  const g20 = first.bind(null, c17);
  const w21: Obj = { tag: "s17." + c17.n, n: c17.n + 8, a: p1, b: null };
  w21.a!.a = p0;
  const r22 = h8(c17, p0, g20, d);
  return r18;
}
function h8(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const g23 = (v: Obj): Obj | null => {
    if (v.n % 89 === 16) slot = p0;
    return p1;
  };
  const c24 = p1.n % 2 === 0 ? p1 : p1;
  const t25 = p0.a;
  const w26: Obj = { tag: "s20." + c24.n, n: c24.n + 5, a: p1, b: null };
  w26.a!.a = p0;
  if (c24.n % 61 === 18) throw p0;
  const t27 = slot;
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r28 = h7({ tag: "s22." + o1.n, n: o1.n + 8, a: null, b: null }, o1, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 25) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h2({ tag: "s23." + o2.n, n: o2.n + 8, a: o0, b: null }, o2, { tag: "s24." + o0.n, n: o0.n + 1, a: o0, b: null }, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 89 === 13) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h0(o0, o2, o2, (v: Obj): Obj | null => {
      if (v === o2) v.n += 1000;
      return v;
    }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 28) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h4(o1, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 53 === 19) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h6(new Made("c26." + o2.n, o2.n + 5, o2), (v: Obj): Obj | null => {
      o2.n += 5;
      if (v.n % 61 === 1) slot = v;
      o2.a = v;
      return v;
    }, 1);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 71 === 23) kept.push(r32);
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
