// Made by test/aot/generate-relations-at-random.ts, seed 19: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, d) {
  const o0 = { tag: "s0." + p0.n, n: p0.n + 8, a: null, b: null };
  const g1 = (v) => {
    v.b = null;
    return new Made("c1." + v.n, v.n + 3, o0);
  };
  const t2 = slot;
  const w3 = { tag: "s2." + o0.n, n: o0.n + 2, a: o0, b: null };
  w3.a.a = o0;
  return { tag: "s3." + p0.n, n: p0.n + 5, a: o0, b: null };
}
function h1(p0, p1, p2, d) {
  let c4 = p0;
  for (let k = 0; k < 3; k++) c4 = c4.b ?? p0;
  const t5 = c4.a;
  bag.set(p0.n % 5, p1);
  const { a: t6 } = p0;
  const r7 = h4(p1, p1, { tag: "s4." + p0.n, n: p0.n + 4, a: null, b: null }, (v) => {
    p0.n += 3;
    p0.b = null;
    if (p2 === p2) p2.n += 1000;
    return v;
  }, d);
  if (c4.n % 31 === 25) slot = p2;
  return null;
}
function h2(p0, d) {
  const g8 = first.bind(null, p0);
  const r9 = d > 0 ? h2({ tag: "s7." + p0.n, n: p0.n + 7, a: null, b: null }, d - 1) : null;
  p0.a = p0;
  const r10 = g8(p0);
  return p0;
}
function h3(p0, p1, d) {
  const w11 = { tag: "s9." + p0.n, n: p0.n + 7, a: p1, b: null };
  w11.a.b = p0;
  const t12 = p0.b;
  p1.a = null;
  if (p1.n % 89 === 8) slot = p1;
  const w13 = { tag: "s10." + p1.n, n: p1.n + 7, a: p0, b: null };
  w13.a.a = p0;
  try {
    if (p0.n % 41 === 10) slot = p0;
    if (p1.n % 53 === 2) throw p1;
  } finally {
    p0.n += 5;
  }
  const o14 = new Made("c11." + p0.n, p0.n + 1, null);
  return null;
}
function h4(p0, p1, p2, f0, d) {
  const r15 = h5({ tag: "s13." + p0.n, n: p0.n + 5, a: null, b: null }, p0, d);
  const c16 = p0.n % 2 === 0 ? p0 : p2;
  const t17 = c16.a;
  const r18 = d > 0 ? h4({ tag: "s14." + c16.n, n: c16.n + 7, a: p0, b: null }, p1, { tag: "s15." + p0.n, n: p0.n + 4, a: null, b: null }, (v) => {
    c16.a = null;
    if (p2.n % 53 === 12) kept.push(c16);
    if (c16.n % 41 === 27) kept.push(p1);
    return c16;
  }, d - 1) : null;
  const { a: t19 } = p2;
  const r20 = h5(c16, p2, d);
  const o21 = { tag: "s17." + p0.n, n: p0.n + 8, a: null, b: null };
  const t22 = bag.get(p0.n % 5) ?? null;
  return r20;
}
function h5(p0, p1, d) {
  const t23 = slot;
  p0.n += 2;
  const t24 = p1.a;
  const w25 = { tag: "s19." + p1.n, n: p1.n + 1, a: p0, b: null };
  w25.a.b = p1;
  return { tag: "s20." + p0.n, n: p0.n + 5, a: p1, b: null };
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r26 = h4(o1, o0, o0, (v) => {
      o1.b = null;
      return v;
    }, 2);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 53 === 22) kept.push(r26);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r27 = h2({ tag: "s22." + o1.n, n: o1.n + 4, a: o2, b: null }, 2);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 61 === 12) kept.push(r27);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r28 = h5(o2, new Made("c23." + o2.n, o2.n + 4, o0), 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 71 === 26) kept.push(r28);
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
