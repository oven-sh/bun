// Made by test/aot/generate-relations-at-random.ts, seed 21: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
const kept = [];
const keptFunctions = [];
let slot = null;
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
class Made {
  b = null;
  constructor(tag, n, a) {
    this.tag = tag;
    this.n = n;
    this.a = a;
  }
}
class Holder {
  held = null;
  hold(o) {
    this.held = o;
  }
  take() {
    const o = this.held;
    this.held = null;
    return o;
  }
}
const holder = new Holder();
const bag = new Map();
function* both(x, y) {
  yield x;
  yield y;
}
function first(x, y) {
  y.n += 1;
  return x;
}
function spy(tag, n) {
  let inner = null;
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
function h0(p0, p1, f0, d) {
  const w0 = new Made("c0." + p1.n, p1.n + 5, p0);
  w0.a.a = p0;
  const r1 = h5.call(null, p0, p0, d);
  let r2 = null;
  try {
    r2 = h7(p1, p1, p1, (v) => {
      p1.b = p0;
      return p1;
    }, d);
  } catch (e) {
    r2 = e;
  }
  const { a: t3 } = p1;
  holder.hold(p0);
  const r4 = h7.apply(null, [p0, { tag: "s2." + p0.n, n: p0.n + 7, a: null, b: null }, p0, f0, d]);
  return r2;
}
function h1(p0, p1, d) {
  if (p1.n % 41 === 21) throw p1;
  for (const v of both(p0, p0)) {
    v.a = null;
  }
  const t5 = p0.a;
  return { tag: "s4." + p1.n, n: p1.n + 5, a: p1, b: null };
}
function h2(p0, p1, p2, d) {
  const w6 = { tag: "s5." + p1.n, n: p1.n + 9, a: p1, b: null };
  w6.a.a = p2;
  if (p2 === p1) p2.n += 1000;
  const t7 = bag.get(p2.n % 5) ?? null;
  const r8 = d > 0 ? h2({ tag: "s6." + p1.n, n: p1.n + 4, a: p0, b: null }, p0, p1, d - 1) : null;
  return p2;
}
function h3(p0, p1, d) {
  try {
    p1.n += 3;
    if (p0.n % 41 === 11) throw p1;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const l9 = [p1, p1];
  l9[1].b = p1;
  return { tag: "s8." + p1.n, n: p1.n + 5, a: p0, b: null };
}
function h4(p0, p1, p2, f0, d) {
  for (const v of both(p0, p1)) {
    if (p2.n % 71 === 23) kept.push(p2);
  }
  const r10 = h7.apply(null, [p1, p1, new Made("c9." + p2.n, p2.n + 9, null), f0, d]);
  if (p0.n % 53 === 27) kept.push(p2);
  const l11 = [p2, p1];
  l11[1].b = p0;
  const t12 = holder.take();
  p0.a = p1;
  bag.set(p1.n % 5, p0);
  const r13 = f0(p1);
  return r10;
}
function h5(p0, p1, d) {
  const t14 = bag.get(p0.n % 5) ?? null;
  const r15 = h6(p0, { tag: "s11." + p0.n, n: p0.n + 4, a: p0, b: null }, (v) => {
    p0.a = p0;
    if (v === p1) v.n += 1000;
    return v;
  }, d);
  const g16 = first.bind(null, p0);
  if (p1.n % 41 === 16) keptFunctions.push(g16);
  const r17 = g16(p1);
  return null;
}
function h6(p0, p1, f0, d) {
  const t18 = p1.a;
  let c19 = p1;
  for (let k = 0; k < 3; k++) c19 = c19.a ?? p1;
  let r20 = null;
  try {
    r20 = h7({ tag: "s14." + p0.n, n: p0.n + 1, a: p0, b: null }, p1, c19, f0, d);
  } catch (e) {
    r20 = e;
  }
  if (p0.n % 37 === 29) keptFunctions.push(f0);
  const r21 = d > 0 ? h6(p0, { tag: "s15." + p1.n, n: p1.n + 2, a: c19, b: null }, f0, d - 1) : null;
  const w22 = { tag: "s16." + p0.n, n: p0.n + 4, a: c19, b: null };
  w22.a.a = p1;
  if (p1.n % 37 === 5) keptFunctions.push(f0);
  const o23 = { tag: "s17." + p0.n, n: p0.n + 7, a: p0, b: null };
  return o23;
}
function h7(p0, p1, p2, f0, d) {
  p0.b = null;
  const r24 = d > 0 ? h7({ tag: "s19." + p0.n, n: p0.n + 9, a: null, b: null }, p0, { tag: "s20." + p1.n, n: p1.n + 7, a: null, b: null }, f0, d - 1) : null;
  p1.b = null;
  const g25 = (v) => {
    v.a = p0;
    v.n += 3;
    p1.n += 4;
    return { tag: "s21." + v.n, n: v.n + 1, a: p2, b: null };
  };
  return r24;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h5(o0, o1, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 17) kept.push(r26);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r27 = h2(o2, { tag: "s23." + o1.n, n: o1.n + 9, a: o2, b: null }, { tag: "s24." + o1.n, n: o1.n + 5, a: null, b: null }, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 61 === 12) kept.push(r27);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r28 = h1(o1, new Made("c25." + o1.n, o1.n + 6, o1), 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 31 === 5) kept.push(r28);
    }
  } catch (e) {
    caught.push(e);
  }
  sum += o0.n + o2.n + (o0.b !== null ? o0.b.n : 0) + (o2.a !== null ? o2.a.n : 0) + (o0 === o2.a ? 1 : 0);
  if (i % 100 === 50) churn(20);
}
console.log(sum, churn(60), kept.length, keptFunctions.length, caught.length);
const probe = { tag: "probe", n: 3, a: null, b: null };
const roots = [slot, holder.held, ...bag.values(), ...kept, ...caught, ...keptFunctions.map(f => f(probe)), probe];
const numbers = new Map();
const queue = [];
const numberOf = (o) => {
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
