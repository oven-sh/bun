// Made by test/aot/generate-relations-at-random.ts, seed 31: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, p2, d) {
  const t0 = holder.take();
  let c1 = p2;
  for (let k = 0; k < 3; k++) c1 = c1.b ?? p2;
  const r2 = h6(p1, p2, d);
  bag.set(c1.n % 5, c1);
  return p0;
}
function h1(p0, d) {
  try {
    p0.n += 2;
    if (p0.n % 37 === 28) throw p0;
  } finally {
    if (p0.n % 37 === 23) slot = p0;
  }
  const t3 = holder.take();
  if (p0.n % 89 === 6) throw p0;
  bag.set(p0.n % 5, p0);
  const r4 = h7(p0, d);
  const w5 = { tag: "s1." + p0.n, n: p0.n + 2, a: p0, b: null };
  w5.a.b = p0;
  p0.a = null;
  return t3;
}
function h2(p0, p1, f0, d) {
  const t6 = p1.b;
  const o7 = { tag: "s3." + p0.n, n: p0.n + 5, a: p0, b: null };
  let r8 = null;
  try {
    r8 = h8(p1, o7, p0, d);
  } catch (e) {
    r8 = e;
  }
  bag.set(o7.n % 5, p0);
  return p1;
}
function h3(p0, p1, p2, d) {
  let c9 = p0;
  for (let k = 0; k < 3; k++) c9 = c9.b ?? p0;
  const t10 = holder.take();
  const { a: t11 } = p1;
  const r12 = h8.apply(null, [p1, c9, { tag: "s5." + p2.n, n: p2.n + 7, a: p1, b: null }, d]);
  bag.set(p0.n % 5, p1);
  return p2;
}
function h4(p0, p1, f0, d) {
  const t13 = holder.take();
  const l14 = [p0, p1];
  l14[1].b = p0;
  const t15 = slot;
  return p0;
}
function h5(p0, p1, p2, d) {
  const r16 = h8({ tag: "s8." + p2.n, n: p2.n + 3, a: p0, b: null }, p1, new Made("c9." + p2.n, p2.n + 9, p1), d);
  const g17 = (v) => {
    p2.b = p2;
    p2.n += 2;
    if (p0.n % 31 === 2) kept.push(v);
    return null;
  };
  if (p2.n % 61 === 23) throw p2;
  if (p2.n % 31 === 0) keptFunctions.push(g17);
  return new Made("c11." + p2.n, p2.n + 1, p0);
}
function h6(p0, p1, d) {
  const g18 = (v) => {
    if (p1.n % 41 === 19) kept.push(p0);
    return v;
  };
  const t19 = bag.get(p0.n % 5) ?? null;
  const r20 = d > 0 ? h6(p0, p0, d - 1) : null;
  for (const v of both(p1, p0)) {
    v.a = null;
  }
  const t21 = slot;
  const r22 = h7.apply(null, [p0, d]);
  return r22;
}
function h7(p0, d) {
  const { b: t23 } = p0;
  for (const v of both(p0, p0)) {
    p0.a = p0;
  }
  const t24 = bag.get(p0.n % 5) ?? null;
  const w25 = { tag: "s14." + p0.n, n: p0.n + 3, a: p0, b: null };
  w25.a.a = p0;
  const r26 = h8(p0, p0, p0, d);
  if (p0.n % 53 === 15) holder.hold(p0);
  let r27 = null;
  try {
    r27 = h8(p0, p0, { tag: "s15." + p0.n, n: p0.n + 3, a: null, b: null }, d);
  } catch (e) {
    r27 = e;
  }
  const r28 = h8({ tag: "s16." + p0.n, n: p0.n + 1, a: null, b: null }, p0, p0, d);
  return r28;
}
function h8(p0, p1, p2, d) {
  const r29 = d > 0 ? h8(p0, p0, p0, d - 1) : null;
  let c30 = p1;
  for (let k = 0; k < 3; k++) c30 = c30.a ?? p1;
  if (c30.n % 61 === 8) throw p1;
  if (r29 !== null) {
    p0.b = p1;
  }
  const t31 = holder.take();
  return t31;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h1(o0, 1);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 53 === 27) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h5({ tag: "s19." + o2.n, n: o2.n + 9, a: o2, b: null }, o1, o0, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 41 === 26) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h8({ tag: "s20." + o2.n, n: o2.n + 6, a: o1, b: null }, o1, { tag: "s21." + o0.n, n: o0.n + 2, a: o1, b: null }, 0);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 37 === 8) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h6({ tag: "s22." + o0.n, n: o0.n + 5, a: o1, b: null }, o0, 1);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 53 === 22) kept.push(r35);
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
