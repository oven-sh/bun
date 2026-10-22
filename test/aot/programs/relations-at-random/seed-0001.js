// Made by test/aot/generate-relations-at-random.ts, seed 1: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const t0 = holder.take();
  let c1 = p0;
  for (let k = 0; k < 3; k++) c1 = c1.b ?? p0;
  for (const v of both(c1, p0)) {
    c1.a = null;
  }
  const t2 = slot;
  const r3 = h6(p0, p0, (v) => {
    v.b = null;
    if (c1 === p0) c1.n += 1000;
    return { tag: "s0." + v.n, n: v.n + 7, a: null, b: null };
  }, d);
  const o4 = { tag: "s1." + c1.n, n: c1.n + 3, a: p0, b: null };
  return c1;
}
function h1(p0, p1, p2, d) {
  try {
    p0.a = p1;
    if (p2.n % 41 === 19) throw p0;
  } finally {
    p1.b = p1;
  }
  const r5 = h4(p0, { tag: "s3." + p1.n, n: p1.n + 2, a: p2, b: null }, { tag: "s4." + p0.n, n: p0.n + 6, a: p1, b: null }, d);
  const t6 = bag.get(p2.n % 5) ?? null;
  const t7 = p0.a;
  const o8 = { tag: "s5." + p2.n, n: p2.n + 8, a: p1, b: null };
  return o8;
}
function h2(p0, d) {
  const t9 = slot;
  const c10 = p0.n % 2 === 0 ? p0 : p0;
  if (c10.n % 41 === 6) throw p0;
  try {
    p0.a = p0;
    if (p0.n % 71 === 11) throw c10;
  } finally {
    if (p0.n % 41 === 26) slot = p0;
  }
  let c11 = c10;
  for (let k = 0; k < 3; k++) c11 = c11.a ?? p0;
  if (p0.n % 31 === 6) holder.hold(c10);
  return c11;
}
function h3(p0, p1, p2, d) {
  if (p1.n % 61 === 0) throw p1;
  p1.b = p0;
  const g12 = (v) => {
    p1.a = null;
    if (p0 === p0) p0.n += 1000;
    return v;
  };
  try {
    p2.a = null;
    if (p0.n % 41 === 18) throw p0;
  } finally {
    if (p1 === p1) p1.n += 1000;
  }
  try {
    p1.a = p1;
    if (p0.n % 61 === 7) throw p0;
  } finally {
    if (p0 === p1) p0.n += 1000;
  }
  const t13 = p0.b;
  const c14 = p1.n % 2 === 0 ? p1 : p2;
  const t15 = p2.b;
  return p2;
}
function h4(p0, p1, p2, d) {
  if (p0.n % 31 === 15) throw p2;
  const t16 = bag.get(p1.n % 5) ?? null;
  if (t16 !== null) {
    p2.b = null;
  }
  return null;
}
function h5(p0, p1, f0, d) {
  const t17 = bag.get(p0.n % 5) ?? null;
  p0.b = p0;
  p1.b = p0;
  const w18 = { tag: "s11." + p0.n, n: p0.n + 9, a: p0, b: null };
  w18.a.b = p0;
  const t19 = p0.b;
  const r20 = h7.apply(null, [p0, d]);
  const t21 = bag.get(p1.n % 5) ?? null;
  for (const v of both(p0, p1)) {
    p0.a = null;
  }
  return p0;
}
function h6(p0, p1, f0, d) {
  const r22 = h7(p1, d);
  holder.hold(p0);
  const g23 = (v) => {
    if (p0 === p1) p0.n += 1000;
    if (p0.n % 61 === 14) slot = p1;
    p0.a = null;
    return p1;
  };
  p1.a = null;
  const t24 = p0.a;
  bag.set(p1.n % 5, p0);
  const r25 = h8(p0, (v) => {
    p1.a = p1;
    p0.b = p1;
    return p0;
  }, d);
  return r25;
}
function h7(p0, d) {
  const t26 = holder.take();
  const w27 = new Made("c16." + p0.n, p0.n + 2, p0);
  w27.a.a = p0;
  if (p0.n % 31 === 18) kept.push(p0);
  return p0;
}
function h8(p0, f0, d) {
  const w28 = { tag: "s18." + p0.n, n: p0.n + 5, a: p0, b: null };
  w28.a.a = p0;
  if (p0.n % 71 === 25) throw p0;
  bag.set(p0.n % 5, p0);
  const w29 = { tag: "s19." + p0.n, n: p0.n + 5, a: p0, b: null };
  w29.a.a = p0;
  const o30 = { tag: "s20." + p0.n, n: p0.n + 4, a: null, b: null };
  return { tag: "s21." + o30.n, n: o30.n + 4, a: o30, b: null };
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r31 = h7(o1, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 3) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h2(o1, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 53 === 14) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h3(o2, new Made("c22." + o2.n, o2.n + 4, o1), o1, 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 10) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h6(o0, o0, (v) => {
      o2.a = o0;
      return o1;
    }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 31 === 19) kept.push(r34);
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
