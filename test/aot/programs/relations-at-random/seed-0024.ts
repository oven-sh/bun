// Made by test/aot/generate-relations-at-random.ts, seed 24: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p2.n % 41 === 23) keptFunctions.push(f0);
  let c0 = p2;
  for (let k = 0; k < 3; k++) c0 = c0.a ?? p1;
  const g1 = first.bind(null, p0);
  const r2 = d > 0 ? h0(c0, p1, { tag: "s0." + c0.n, n: c0.n + 5, a: null, b: null }, g1, d - 1) : null;
  const l3 = [c0, p2];
  l3[0].b = p0;
  return null;
}
function h1(p0: Obj, d: number): Obj | null {
  for (const v of both(p0, p0)) {
    if (v.n % 31 === 27) kept.push(p0);
  }
  let r4: Obj | null = null;
  try {
    r4 = h6({ tag: "s2." + p0.n, n: p0.n + 4, a: p0, b: null }, { tag: "s3." + p0.n, n: p0.n + 8, a: null, b: null }, d);
  } catch (e) {
    r4 = e as Obj;
  }
  const w5: Obj = new Made("c4." + p0.n, p0.n + 6, p0);
  w5.a!.a = p0;
  const t6 = slot;
  let c7 = p0;
  for (let k = 0; k < 3; k++) c7 = c7.a ?? p0;
  const g8 = (v: Obj): Obj | null => {
    c7.b = null;
    return c7;
  };
  return null;
}
function h2(p0: Obj, f0: Fn, d: number): Obj | null {
  const { a: t9 } = p0;
  const c10 = p0.n % 2 === 0 ? p0 : p0;
  if (p0.n % 71 === 24) throw c10;
  const r11 = h5.call(null, p0, (v: Obj): Obj | null => {
    if (p0.n % 89 === 13) kept.push(p0);
    return { tag: "s7." + v.n, n: v.n + 7, a: v, b: null };
  }, d);
  return p0;
}
function h3(p0: Obj, p1: Obj, d: number): Obj | null {
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.b ?? p1;
  const g13 = first.bind(null, p0);
  const t14 = bag.get(p0.n % 5) ?? null;
  const g15 = first.bind(null, p0);
  holder.hold(c12);
  const c16 = p0.n % 2 === 0 ? p0 : p0;
  return p0;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t17 = slot;
  if (p2.n % 89 === 26) throw p0;
  bag.set(p1.n % 5, p2);
  const c18 = p1.n % 2 === 0 ? p1 : p2;
  if (p2.n % 53 === 19) throw p1;
  return c18;
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const w19: Obj = { tag: "s11." + p0.n, n: p0.n + 1, a: p0, b: null };
  w19.a!.b = p0;
  const r20 = h6({ tag: "s12." + p0.n, n: p0.n + 5, a: p0, b: null }, p0, d);
  const r21 = h6(p0, p0, d);
  p0.b = null;
  const r22 = f0(p0);
  return r21;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const t23 = holder.take();
  const o24: Obj = { tag: "s14." + p0.n, n: p0.n + 8, a: p1, b: null };
  const t25 = holder.take();
  const r26 = d > 0 ? h6(o24, o24, d - 1) : null;
  if (t23 !== null) {
    t23.b = null;
  }
  if (r26 !== null) {
    o24.b = r26;
  }
  return null;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r27 = h3(o0, { tag: "s16." + o1.n, n: o1.n + 5, a: o2, b: null }, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 37 === 0) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h2(o0, (v: Obj): Obj | null => {
      o0.b = null;
      if (o1 === o0) o1.n += 1000;
      return o0;
    }, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 41 === 19) kept.push(r28);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r29 = h0(o1, o2, o0, (v: Obj): Obj | null => {
      o2.n += 3;
      o2.b = null;
      o0.n += 1;
      return v;
    }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 61 === 23) kept.push(r29);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r30 = h3(o1, { tag: "s19." + o2.n, n: o2.n + 8, a: o2, b: null }, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 61 === 19) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h5({ tag: "s20." + o2.n, n: o2.n + 2, a: o0, b: null }, (v: Obj): Obj | null => {
      o0.a = null;
      return { tag: "s21." + v.n, n: v.n + 2, a: null, b: null };
    }, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 1) kept.push(r31);
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
