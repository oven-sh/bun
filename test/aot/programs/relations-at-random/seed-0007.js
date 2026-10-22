// Made by test/aot/generate-relations-at-random.ts, seed 7: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = (v) => {
    p0.b = v;
    p0.a = p0;
    return { tag: "s0." + v.n, n: v.n + 1, a: v, b: null };
  };
  let c1 = p0;
  for (let k = 0; k < 3; k++) c1 = c1.b ?? p0;
  bag.set(c1.n % 5, c1);
  if (p0.n % 41 === 0) throw p0;
  if (p0.n % 41 === 14) throw c1;
  let c2 = c1;
  for (let k = 0; k < 3; k++) c2 = c2.a ?? c1;
  return c1;
}
function h1(p0, p1, p2, d) {
  p2.a = null;
  const r3 = h5.apply(null, [p1, d]);
  bag.set(p2.n % 5, p1);
  return r3;
}
function h2(p0, p1, d) {
  bag.set(p1.n % 5, p1);
  if (p0.n % 41 === 7) holder.hold(p1);
  const g4 = first.bind(null, p0);
  const t5 = p1.b;
  const g6 = (v) => {
    if (p1 === v) p1.n += 1000;
    v.b = null;
    if (p1.n % 37 === 24) kept.push(p0);
    return { tag: "s3." + v.n, n: v.n + 6, a: null, b: null };
  };
  const g7 = first.bind(null, p1);
  p1.b = p1;
  return t5;
}
function h3(p0, d) {
  const r8 = h4(new Made("c5." + p0.n, p0.n + 2, null), p0, p0, (v) => {
    if (v.n % 53 === 23) slot = v;
    if (p0.n % 53 === 23) kept.push(v);
    return { tag: "s6." + v.n, n: v.n + 8, a: p0, b: null };
  }, d);
  if (p0.n % 89 === 7) throw p0;
  bag.set(p0.n % 5, p0);
  p0.n += 2;
  try {
    p0.n += 4;
    if (p0.n % 89 === 16) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  return r8;
}
function h4(p0, p1, p2, f0, d) {
  try {
    p0.b = p0;
    if (p2.n % 89 === 23) throw p2;
  } finally {
    p2.b = p2;
  }
  let r9 = null;
  try {
    r9 = h5(p1, d);
  } catch (e) {
    r9 = e;
  }
  p0.n += 1;
  return { tag: "s8." + p2.n, n: p2.n + 5, a: p1, b: null };
}
function h5(p0, d) {
  const g10 = (v) => {
    p0.b = null;
    v.n += 5;
    return { tag: "s9." + v.n, n: v.n + 4, a: null, b: null };
  };
  const { b: t11 } = p0;
  const r12 = g10(p0);
  const l13 = [p0, p0];
  l13[1].a = p0;
  let c14 = p0;
  for (let k = 0; k < 3; k++) c14 = c14.a ?? p0;
  const w15 = { tag: "s10." + p0.n, n: p0.n + 5, a: p0, b: null };
  w15.a.a = c14;
  bag.set(p0.n % 5, c14);
  return c14;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r16 = h3({ tag: "s12." + o0.n, n: o0.n + 3, a: null, b: null }, 0);
    if (r16 !== null) {
      sum += r16.n;
      if (r16.n % 53 === 2) kept.push(r16);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r17 = h3(o0, 1);
    if (r17 !== null) {
      sum += r17.n;
      if (r17.n % 71 === 5) kept.push(r17);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r18 = h1(o0, { tag: "s13." + o2.n, n: o2.n + 6, a: null, b: null }, o0, 0);
    if (r18 !== null) {
      sum += r18.n;
      if (r18.n % 53 === 2) kept.push(r18);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r19 = h3(o0, 2);
    if (r19 !== null) {
      sum += r19.n;
      if (r19.n % 53 === 11) kept.push(r19);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r20 = h0(o0, 2);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 37 === 10) kept.push(r20);
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
