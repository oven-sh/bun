// Made by test/aot/generate-relations-at-random.ts, seed 9: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, p2, f0, d) {
  const c0 = p0.n % 2 === 0 ? p0 : p2;
  const r1 = h5.call(null, c0, new Made("c0." + p2.n, p2.n + 8, p1), f0, d);
  for (const v of both(p0, c0)) {
    p0.n += 2;
  }
  c0.b = p2;
  const t2 = holder.take();
  if (p2.n % 61 === 14) keptFunctions.push(f0);
  const c3 = c0.n % 2 === 0 ? c0 : p2;
  try {
    if (c3.n % 31 === 19) slot = p0;
    if (p2.n % 61 === 29) throw c0;
  } finally {
    if (c0.n % 37 === 20) slot = c3;
  }
  return null;
}
function h1(p0, p1, p2, d) {
  for (const v of both(p2, p0)) {
    if (v === p0) v.n += 1000;
  }
  const r4 = h5(p1, p2, (v) => {
    if (p0 === p2) p0.n += 1000;
    return null;
  }, d);
  const o5 = new Made("c3." + p0.n, p0.n + 2, p0);
  bag.set(p0.n % 5, p1);
  return p2;
}
function h2(p0, p1, p2, f0, d) {
  bag.set(p1.n % 5, p2);
  const r6 = h5.call(null, { tag: "s5." + p1.n, n: p1.n + 4, a: p1, b: null }, p2, (v) => {
    v.b = p0;
    if (v.n % 89 === 23) slot = v;
    return v;
  }, d);
  if (p1.n % 89 === 1) keptFunctions.push(f0);
  let r7 = null;
  try {
    r7 = h4(p0, p1, d);
  } catch (e) {
    r7 = e;
  }
  const o8 = { tag: "s7." + p0.n, n: p0.n + 1, a: p2, b: null };
  if (p0.n % 89 === 13) keptFunctions.push(f0);
  const t9 = holder.take();
  const r10 = h4.apply(null, [{ tag: "s8." + p0.n, n: p0.n + 7, a: p1, b: null }, p1, d]);
  return null;
}
function h3(p0, p1, p2, f0, d) {
  if (p0.n % 71 === 14) kept.push(p1);
  const t11 = holder.take();
  const g12 = first.bind(null, p0);
  if (t11 !== null) {
    p2.b = null;
  }
  return { tag: "s10." + p2.n, n: p2.n + 7, a: p0, b: null };
}
function h4(p0, p1, d) {
  const c13 = p0.n % 2 === 0 ? p0 : p0;
  try {
    if (p0 === p1) p0.n += 1000;
    if (c13.n % 71 === 1) throw p0;
  } finally {
    c13.n += 2;
  }
  for (const v of both(c13, c13)) {
    v.a = c13;
  }
  let c14 = p0;
  for (let k = 0; k < 3; k++) c14 = c14.b ?? p0;
  return { tag: "s11." + p0.n, n: p0.n + 6, a: c14, b: null };
}
function h5(p0, p1, f0, d) {
  const t15 = holder.take();
  const t16 = p0.a;
  const c17 = p1.n % 2 === 0 ? p1 : p1;
  const g18 = (v) => {
    if (c17.n % 89 === 4) kept.push(p1);
    return p0;
  };
  const w19 = { tag: "s13." + p0.n, n: p0.n + 5, a: c17, b: null };
  w19.a.b = c17;
  if (c17.n % 89 === 14) slot = p1;
  const r20 = g18(c17);
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h3(o0, o1, o2, (v) => {
      o1.b = o0;
      return null;
    }, 0);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 71 === 16) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h4(o1, o0, 1);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 8) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h2(o1, o2, o2, (v) => {
      o2.n += 3;
      if (o1 === o0) o1.n += 1000;
      return o0;
    }, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 71 === 17) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h5(o2, o1, (v) => {
      o2.b = null;
      if (o0 === o2) o0.n += 1000;
      return o1;
    }, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 89 === 24) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h2(o2, o2, o0, (v) => {
      o0.b = null;
      v.b = null;
      o1.a = null;
      return o1;
    }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 41 === 6) kept.push(r25);
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
