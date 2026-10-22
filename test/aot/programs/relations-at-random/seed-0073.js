// Made by test/aot/generate-relations-at-random.ts, seed 73: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = (v) => {
    p2.b = v;
    p2.n += 5;
    if (v === p2) v.n += 1000;
    return v;
  };
  const t1 = slot;
  try {
    p0.b = null;
    if (p2.n % 89 === 14) throw p2;
  } finally {
    if (p1 === p0) p1.n += 1000;
  }
  const l2 = [p1, p0];
  l2[1].b = p0;
  return p2;
}
function h1(p0, d) {
  for (const v of both(p0, p0)) {
    p0.a = p0;
  }
  const g3 = (v) => {
    p0.a = p0;
    v.n += 2;
    return { tag: "s2." + v.n, n: v.n + 4, a: p0, b: null };
  };
  p0.n += 5;
  try {
    p0.a = null;
    if (p0.n % 53 === 11) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const r4 = d > 0 ? h1({ tag: "s3." + p0.n, n: p0.n + 9, a: null, b: null }, d - 1) : null;
  return r4;
}
function h2(p0, f0, d) {
  const t5 = p0.a;
  const r6 = h7.apply(null, [p0, p0, f0, d]);
  let c7 = p0;
  for (let k = 0; k < 3; k++) c7 = c7.b ?? p0;
  return r6;
}
function h3(p0, d) {
  holder.hold(p0);
  const t8 = bag.get(p0.n % 5) ?? null;
  const l9 = [p0, p0];
  l9[0].a = p0;
  const g10 = first.bind(null, p0);
  return new Made("c6." + p0.n, p0.n + 6, null);
}
function h4(p0, f0, d) {
  const t11 = holder.take();
  const g12 = first.bind(null, p0);
  if (p0.n % 71 === 7) kept.push(p0);
  const t13 = holder.take();
  let r14 = null;
  try {
    r14 = h5(p0, p0, d);
  } catch (e) {
    r14 = e;
  }
  const { a: t15 } = p0;
  const r16 = h6({ tag: "s7." + p0.n, n: p0.n + 1, a: null, b: null }, p0, d);
  const c17 = p0.n % 2 === 0 ? p0 : p0;
  return null;
}
function h5(p0, p1, d) {
  const t18 = p0.b;
  const r19 = d > 0 ? h5(p1, p0, d - 1) : null;
  const c20 = p0.n % 2 === 0 ? p0 : p0;
  const g21 = (v) => {
    if (p1.n % 53 === 6) kept.push(v);
    return p0;
  };
  const w22 = { tag: "s10." + c20.n, n: c20.n + 3, a: c20, b: null };
  w22.a.a = p0;
  const g23 = first.bind(null, p1);
  const r24 = d > 0 ? h5(c20, p0, d - 1) : null;
  const t25 = bag.get(p0.n % 5) ?? null;
  return r19;
}
function h6(p0, p1, d) {
  const r26 = d > 0 ? h6({ tag: "s12." + p1.n, n: p1.n + 3, a: p1, b: null }, p0, d - 1) : null;
  try {
    if (p1 === p0) p1.n += 1000;
    if (p1.n % 53 === 28) throw p0;
  } finally {
    if (p0.n % 53 === 13) kept.push(p0);
  }
  for (const v of both(p0, p0)) {
    p1.b = null;
  }
  const w27 = { tag: "s13." + p1.n, n: p1.n + 5, a: p0, b: null };
  w27.a.b = p1;
  if (p0.n % 41 === 26) throw p0;
  const g28 = first.bind(null, p0);
  return p1;
}
function h7(p0, p1, f0, d) {
  const r29 = h8.call(null, p1, { tag: "s15." + p0.n, n: p0.n + 9, a: p1, b: null }, (v) => {
    if (p1.n % 61 === 4) slot = p1;
    if (v.n % 41 === 20) slot = p0;
    v.b = p0;
    return p0;
  }, d);
  const r30 = f0(p0);
  const g31 = first.bind(null, p0);
  if (p0.n % 89 === 12) keptFunctions.push(g31);
  const g32 = (v) => {
    v.n += 2;
    if (p0 === p1) p0.n += 1000;
    return p1;
  };
  const t33 = bag.get(p1.n % 5) ?? null;
  const r34 = f0(p0);
  const t35 = slot;
  return p1;
}
function h8(p0, p1, f0, d) {
  const g36 = (v) => {
    if (v.n % 37 === 7) kept.push(p1);
    if (p0 === p1) p0.n += 1000;
    return p1;
  };
  try {
    if (p0 === p1) p0.n += 1000;
    if (p1.n % 41 === 10) throw p1;
  } finally {
    if (p1.n % 31 === 21) slot = p1;
  }
  return { tag: "s20." + p1.n, n: p1.n + 2, a: null, b: null };
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r37 = h5(o1, o2, 0);
    if (r37 !== null) {
      sum += r37.n;
      if (r37.n % 71 === 18) kept.push(r37);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r38 = h7(o2, o1, (v) => {
      o1.n += 2;
      o2.b = null;
      o1.b = null;
      return o0;
    }, 2);
    if (r38 !== null) {
      sum += r38.n;
      if (r38.n % 53 === 25) kept.push(r38);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r39 = h4(o0, (v) => {
      o2.a = o1;
      o1.n += 3;
      return v;
    }, 2);
    if (r39 !== null) {
      sum += r39.n;
      if (r39.n % 71 === 3) kept.push(r39);
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
