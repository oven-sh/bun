// Made by test/aot/generate-relations-at-random.ts, seed 18: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0: Obj, p1: Obj, d: number): Obj | null {
  const t0 = bag.get(p1.n % 5) ?? null;
  holder.hold(p0);
  if (p0.n % 37 === 9) slot = p0;
  return new Made("c0." + p0.n, p0.n + 8, null);
}
function h1(p0: Obj, d: number): Obj | null {
  const t1 = bag.get(p0.n % 5) ?? null;
  const w2: Obj = { tag: "s1." + p0.n, n: p0.n + 5, a: p0, b: null };
  w2.a!.a = p0;
  const o3: Obj = { tag: "s2." + p0.n, n: p0.n + 4, a: null, b: null };
  const r4 = h5(p0, p0, (v: Obj): Obj | null => {
    if (v.n % 89 === 21) slot = p0;
    return null;
  }, d);
  const g5 = first.bind(null, o3);
  if (r4 !== null) {
    if (r4.n % 89 === 7) slot = r4;
  }
  return p0;
}
function h2(p0: Obj, p1: Obj, d: number): Obj | null {
  const l6 = [p1, p0];
  l6[1].a = p1;
  if (p1.n % 89 === 8) throw p1;
  const g7 = (v: Obj): Obj | null => {
    if (p0 === p0) p0.n += 1000;
    return v;
  };
  if (p1 === p1) p1.n += 1000;
  p1.b = p0;
  return p1;
}
function h3(p0: Obj, f0: Fn, d: number): Obj | null {
  const t8 = bag.get(p0.n % 5) ?? null;
  const r9 = h5.apply(null, [new Made("c7." + p0.n, p0.n + 5, null), { tag: "s8." + p0.n, n: p0.n + 7, a: null, b: null }, (v: Obj): Obj | null => {
    if (v.n % 31 === 28) slot = v;
    v.b = v;
    v.n += 4;
    return { tag: "s9." + v.n, n: v.n + 8, a: v, b: null };
  }, d]);
  if (p0.n % 41 === 0) keptFunctions.push(f0);
  const r10 = h6(new Made("c10." + p0.n, p0.n + 6, null), p0, d);
  const w11: Obj = { tag: "s11." + p0.n, n: p0.n + 2, a: p0, b: null };
  w11.a!.b = p0;
  return r10;
}
function h4(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  p0.n += 5;
  let c12 = p1;
  for (let k = 0; k < 3; k++) c12 = c12.a ?? p1;
  const t13 = p1.a;
  return null;
}
function h5(p0: Obj, p1: Obj, f0: Fn, d: number): Obj | null {
  const g14 = first.bind(null, p1);
  const t15 = slot;
  if (p0.n % 41 === 18) holder.hold(p0);
  const g16 = (v: Obj): Obj | null => {
    if (v === v) v.n += 1000;
    v.a = p0;
    if (p0.n % 61 === 4) kept.push(v);
    return v;
  };
  const l17 = [p0, p0];
  l17[0].a = p0;
  return p0;
}
function h6(p0: Obj, p1: Obj, d: number): Obj | null {
  const { a: t18 } = p0;
  p1.a = p1;
  const t19 = slot;
  const { a: t20 } = p1;
  const l21 = [p1, p1];
  l21[0].b = p0;
  const t22 = bag.get(p0.n % 5) ?? null;
  return t19;
}
const caught: Obj[] = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0: Obj = { tag: "o0." + i, n: i, a: null, b: null };
  const o1: Obj = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2: Obj = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r23 = h1(o0, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 71 === 16) kept.push(r23);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r24 = h5({ tag: "s17." + o0.n, n: o0.n + 2, a: null, b: null }, o1, (v: Obj): Obj | null => {
      o2.a = o0;
      o0.a = v;
      return null;
    }, 2);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 31 === 10) kept.push(r24);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r25 = h5(o2, o1, (v: Obj): Obj | null => {
      o1.n += 3;
      return { tag: "s19." + v.n, n: v.n + 1, a: o0, b: null };
    }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 53 === 27) kept.push(r25);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r26 = h4(o0, o2, (v: Obj): Obj | null => {
      if (o1.n % 37 === 21) slot = o2;
      v.n += 5;
      o2.n += 1;
      return o0;
    }, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 12) kept.push(r26);
    }
  } catch (e) {
    caught.push(e as Obj);
  }
  try {
    const r27 = h6(o0, o1, 1);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 61 === 21) kept.push(r27);
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
