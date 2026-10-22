// Made by test/aot/generate-relations-at-random.ts, seed 80: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  if (p1.n % 89 === 21) throw p2;
  const t0 = holder.take();
  const l1 = [p0, p0];
  l1[1].b = p0;
  if (p0.n % 89 === 28) holder.hold(p0);
  return { tag: "s0." + p0.n, n: p0.n + 3, a: p0, b: null };
}
function h1(p0: Obj, d: number): Obj | null {
  const t2 = p0.a;
  const t3 = p0.a;
  return { tag: "s1." + p0.n, n: p0.n + 5, a: null, b: null };
}
function h2(p0: Obj, p1: Obj, p2: Obj, d: number): Obj | null {
  try {
    if (p1 === p1) p1.n += 1000;
    if (p0.n % 89 === 21) throw p2;
  } finally {
    if (p0.n % 53 === 4) kept.push(p0);
  }
  let c4 = p1;
  for (let k = 0; k < 3; k++) c4 = c4.a ?? p1;
  bag.set(c4.n % 5, p0);
  const t5 = holder.take();
  return p0;
}
function h3(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  for (const v of both(p1, p1)) {
    if (p0.n % 41 === 9) slot = p0;
  }
  const t6 = bag.get(p0.n % 5) ?? null;
  const t7 = slot;
  return t6;
}
function h4(p0: Obj, d: number): Obj | null {
  const g8 = first.bind(null, p0);
  const g9 = (v: Obj): Obj | null => {
    if (v.n % 89 === 19) slot = p0;
    v.a = null;
    return p0;
  };
  return null;
}
function h5(p0: Obj, d: number): Obj | null {
  let r10: Obj | null = null;
  try {
    r10 = h7(p0, p0, (v: Obj): Obj | null => {
      v.b = null;
      return { tag: "s6." + v.n, n: v.n + 9, a: null, b: null };
    }, d);
  } catch (e) {
    r10 = e as Obj;
  }
  const g11 = first.bind(null, p0);
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.b ?? p0;
  const g13 = (v: Obj): Obj | null => {
    c12.b = p0;
    p0.b = null;
    p0.a = c12;
    return p0;
  };
  const g14 = (v: Obj): Obj | null => {
    v.b = null;
    if (p0 === v) p0.n += 1000;
    c12.n += 3;
    return v;
  };
  return p0;
}
function h6(p0: Obj, d: number): Obj | null {
  const r15 = h7(new Made("c10." + p0.n, p0.n + 8, p0), { tag: "s11." + p0.n, n: p0.n + 4, a: null, b: null }, (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    p0.b = p0;
    return null;
  }, d);
  const r16 = d > 0 ? h6({ tag: "s13." + p0.n, n: p0.n + 6, a: p0, b: null }, d - 1) : null;
  const t17 = slot;
  const t18 = holder.take();
  if (p0.n % 37 === 18) holder.hold(p0);
  return { tag: "s14." + p0.n, n: p0.n + 1, a: p0, b: null };
}
function h7(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const t19 = bag.get(p1.n % 5) ?? null;
  if (p0.n % 53 === 27) keptFunctions.push(f0);
  let r20: Obj | null = null;
  try {
    r20 = h8({ tag: "s15." + p0.n, n: p0.n + 4, a: p1, b: null }, f0, d);
  } catch (e) {
    r20 = e as Obj;
  }
  return p0;
}
function h8(p0: Obj, f0: Fn, d: number): Obj | null {
  for (const v of both(p0, p0)) {
    p0.a = null;
  }
  const r21 = f0(p0);
  const c22 = p0.n % 2 === 0 ? p0 : p0;
  if (p0.n % 53 === 18) throw p0;
  return { tag: "s17." + p0.n, n: p0.n + 5, a: c22, b: null };
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r23 = h3(o1, o0, (v: Obj): Obj | null => {
      o1.a = o1;
      if (o0.n % 53 === 29) kept.push(o1);
      v.a = o1;
      return { tag: "s18." + v.n, n: v.n + 3, a: null, b: null };
    }, 0);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 71 === 25) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h0(o0, { tag: "s19." + o1.n, n: o1.n + 7, a: o1, b: null }, o1, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 41 === 3) kept.push(r24);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r25 = h8(o0, (v: Obj): Obj | null => {
      if (v.n % 89 === 12) kept.push(o2);
      return v;
    }, 1);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 31 === 7) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h5({ tag: "s21." + o0.n, n: o0.n + 3, a: null, b: null }, 2);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 37 === 18) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h7(o1, o0, (v: Obj): Obj | null => {
      if (v.n % 41 === 18) kept.push(o1);
      return o0;
    }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 61 === 20) kept.push(r27);
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
