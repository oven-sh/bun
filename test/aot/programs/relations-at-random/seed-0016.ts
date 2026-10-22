// Made by test/aot/generate-relations-at-random.ts, seed 16: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, d: number): Obj | null {
  const c0 = p0.n % 2 === 0 ? p0 : p0;
  const r1 = h1(p0, c0, (v: Obj): Obj | null => {
    if (c0 === c0) c0.n += 1000;
    v.b = null;
    v.a = c0;
    return c0;
  }, d);
  return r1;
}
function h1(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const g2 = (v: Obj): Obj | null => {
    v.a = p0;
    if (p0.n % 53 === 27) kept.push(v);
    return v;
  };
  holder.hold(p0);
  const c3 = p0.n % 2 === 0 ? p0 : p0;
  return p1;
}
function h2(p0: Obj, d: number): Obj | null {
  try {
    p0.a = null;
    if (p0.n % 31 === 3) throw p0;
  } finally {
    p0.b = p0;
  }
  const t4 = holder.take();
  const o5: Obj = { tag: "s4." + p0.n, n: p0.n + 8, a: p0, b: null };
  const c6 = o5.n % 2 === 0 ? o5 : p0;
  return p0;
}
function h3(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const r7 = d > 0 ? h3(p0, p1, (v: Obj): Obj | null => {
    p1.b = p0;
    return p0;
  }, d - 1) : null;
  try {
    if (p1.n % 53 === 22) slot = p1;
    if (p1.n % 71 === 11) throw p1;
  } finally {
    if (p0.n % 89 === 2) kept.push(p1);
  }
  if (p1.n % 89 === 22) holder.hold(p0);
  if (r7 !== null) {
    p0.b = null;
  }
  return p0;
}
function h4(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  const g8 = (v: Obj): Obj | null => {
    p0.n += 3;
    v.b = p2;
    return p1;
  };
  const o9: Obj = new Made("c9." + p1.n, p1.n + 2, p1);
  const w10: Obj = new Made("c10." + o9.n, o9.n + 2, o9);
  w10.a!.a = o9;
  const o11: Obj = new Made("c11." + o9.n, o9.n + 8, p0);
  try {
    if (p2.n % 37 === 18) kept.push(p1);
    if (p1.n % 71 === 13) throw p2;
  } finally {
    if (o9.n % 53 === 24) slot = p1;
  }
  const r12 = g8(o9);
  if (p0.n % 53 === 15) throw o11;
  p0.n += 5;
  return { tag: "s12." + p1.n, n: p1.n + 6, a: o9, b: null };
}
function h5(p0: Obj, f0: Fn, d: number): Obj | null {
  const t13 = holder.take();
  if (p0.n % 89 === 24) keptFunctions.push(f0);
  const c14 = p0.n % 2 === 0 ? p0 : p0;
  const l15 = [p0, c14];
  l15[0].b = p0;
  return null;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const c16 = p0.n % 2 === 0 ? p0 : p0;
  let r17: Obj | null = null;
  try {
    r17 = h8(p0, p0, d);
  } catch (e) {
    r17 = e as Obj;
  }
  if (p0.n % 61 === 8) throw p0;
  const r18 = h8(p1, p1, d);
  const t19 = slot;
  if (p1.n % 41 === 28) throw p1;
  const t20 = p1.b;
  try {
    p1.a = p1;
    if (c16.n % 71 === 21) throw p0;
  } finally {
    p0.a = null;
  }
  return t19;
}
function h7(p0: Obj, p1: Obj, p2: Obj, f0: Fn, d: number): Obj | null {
  if (p1.n % 53 === 21) kept.push(p1);
  const l21 = [p1, p2];
  l21[1].b = p2;
  const l22 = [p1, p0];
  l22[0].a = p2;
  return null;
}
function h8(p0: Obj, p1: Obj, d: number): Obj | null {
  const t23 = holder.take();
  if (t23 !== null) {
    if (p1 === p0) p1.n += 1000;
  }
  try {
    p0.b = p1;
    if (p1.n % 37 === 22) throw p1;
  } finally {
    p1.a = p1;
  }
  const w24: Obj = { tag: "s16." + p0.n, n: p0.n + 8, a: p1, b: null };
  w24.a!.b = p0;
  if (p1.n % 71 === 25) slot = p0;
  try {
    if (p0.n % 31 === 19) kept.push(p0);
    if (p0.n % 37 === 10) throw p0;
  } finally {
    if (p0.n % 71 === 18) slot = p1;
  }
  return { tag: "s17." + p1.n, n: p1.n + 1, a: null, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r25 = h5(o1, (v: Obj): Obj | null => {
      if (o1 === o1) o1.n += 1000;
      if (o0 === o1) o0.n += 1000;
      return o2;
    }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 37 === 4) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h8(o1, o2, 2);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 71 === 12) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h4(o2, new Made("c19." + o1.n, o1.n + 5, null), o1, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 37 === 22) kept.push(r27);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r28 = h7({ tag: "s20." + o1.n, n: o1.n + 1, a: o0, b: null }, { tag: "s21." + o2.n, n: o2.n + 7, a: o0, b: null }, { tag: "s22." + o1.n, n: o1.n + 7, a: null, b: null }, (v: Obj): Obj | null => {
      o0.b = null;
      o1.n += 2;
      o1.a = o2;
      return v;
    }, 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 6) kept.push(r28);
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
