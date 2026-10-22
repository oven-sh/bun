// Made by test/aot/generate-relations-at-random.ts, seed 40: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c0 = p1.n % 2 === 0 ? p1 : p2;
  const r1 = h6({ tag: "s0." + c0.n, n: c0.n + 6, a: p2, b: null }, (v: Obj): Obj | null => {
    c0.b = null;
    return v;
  }, d);
  const r2 = h2({ tag: "s2." + p1.n, n: p1.n + 1, a: p2, b: null }, p0, { tag: "s3." + p0.n, n: p0.n + 1, a: p0, b: null }, d);
  const w3: Obj = { tag: "s4." + p1.n, n: p1.n + 7, a: p1, b: null };
  w3.a!.b = p1;
  if (p2.n % 61 === 28) throw c0;
  const g4 = (v: Obj): Obj | null => {
    if (p1 === v) p1.n += 1000;
    return p1;
  };
  const g5 = (v: Obj): Obj | null => {
    if (v === v) v.n += 1000;
    return null;
  };
  return p1;
}
function h1(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const r6 = h2.call(null, p0, p2, p0, d);
  const { b: t7 } = p1;
  const r8 = h8.call(null, p2, new Made("c8." + p2.n, p2.n + 6, p2), d);
  for (const v of both(p1, p1)) {
    if (p2 === p0) p2.n += 1000;
  }
  if (t7 !== null) {
    if (p1 === p0) p1.n += 1000;
  }
  return p2;
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const t9 = slot;
  const g10 = first.bind(null, p0);
  p1.b = p1;
  const t11 = bag.get(p0.n % 5) ?? null;
  return t9;
}
function h3(p0: Obj, f0: Fn, d: number): Obj | null {
  if (p0.n % 53 === 10) holder.hold(p0);
  if (p0.n % 89 === 3) keptFunctions.push(f0);
  const g12 = (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    if (v.n % 37 === 21) slot = v;
    if (p0.n % 41 === 17) kept.push(p0);
    return v;
  };
  return p0;
}
function h4(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  const t13 = bag.get(p2.n % 5) ?? null;
  for (const v of both(p2, p1)) {
    if (p2.n % 31 === 9) slot = p0;
  }
  holder.hold(p2);
  const r14 = f0(p2);
  const r15 = h7(p2, { tag: "s13." + p1.n, n: p1.n + 4, a: p0, b: null }, new Made("c14." + p1.n, p1.n + 9, p1), d);
  holder.hold(p0);
  if (p2.n % 71 === 5) slot = p0;
  return null;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r16 = h8(new Made("c16." + p0.n, p0.n + 8, null), p0, d);
  const w17: Obj = new Made("c17." + p1.n, p1.n + 2, p0);
  w17.a!.b = p1;
  let c18 = p0;
  for (let k = 0; k < 3; k++) c18 = c18.b ?? p1;
  const o19: Obj = { tag: "s18." + p0.n, n: p0.n + 8, a: p0, b: null };
  const t20 = holder.take();
  let r21: Obj | null = null;
  try {
    r21 = h6(p0, f0, d);
  } catch (e) {
    r21 = e as Obj;
  }
  return null;
}
function h6(p0: Obj, f0: Fn, d: number): Obj | null {
  const w22: Obj = { tag: "s20." + p0.n, n: p0.n + 4, a: p0, b: null };
  w22.a!.b = p0;
  let r23: Obj | null = null;
  try {
    r23 = h8(p0, p0, d);
  } catch (e) {
    r23 = e as Obj;
  }
  const w24: Obj = { tag: "s21." + p0.n, n: p0.n + 2, a: p0, b: null };
  w24.a!.b = p0;
  const g25 = first.bind(null, p0);
  return r23;
}
function h7(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1 === p0) p1.n += 1000;
  const r26 = d > 0 ? h7(p1, p1, p1, d - 1) : null;
  if (p1.n % 31 === 21) holder.hold(p0);
  if (r26 !== null) {
    if (p2.n % 53 === 20) kept.push(r26);
  }
  const { a: t27 } = p1;
  return t27;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const o28: Obj = { tag: "s24." + p1.n, n: p1.n + 6, a: p0, b: null };
  p0.b = p0;
  const o29: Obj = { tag: "s25." + p1.n, n: p1.n + 6, a: null, b: null };
  if (p1.n % 31 === 3) throw o28;
  return o28;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h4({ tag: "s27." + o1.n, n: o1.n + 1, a: o0, b: null }, o1, { tag: "s28." + o1.n, n: o1.n + 1, a: o0, b: null }, (v: Obj): Obj | null => {
      if (o2.n % 41 === 14) kept.push(o2);
      v.b = o1;
      return new Made("c29." + v.n, v.n + 8, null);
    }, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 17) kept.push(r30);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r31 = h8(o0, o2, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 89 === 14) kept.push(r31);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r32 = h4(o2, o0, { tag: "s30." + o2.n, n: o2.n + 3, a: null, b: null }, (v: Obj): Obj | null => {
      if (o2.n % 61 === 21) kept.push(o1);
      return o1;
    }, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 61 === 21) kept.push(r32);
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
