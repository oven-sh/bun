// Made by test/aot/generate-relations-at-random.ts, seed 27: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, f0, d) {
  p0.b = p0;
  const r0 = h2({ tag: "s0." + p0.n, n: p0.n + 9, a: null, b: null }, f0, d);
  const w1 = { tag: "s1." + p0.n, n: p0.n + 4, a: p0, b: null };
  w1.a.a = p0;
  const g2 = (v) => {
    v.n += 1;
    p0.b = v;
    return v;
  };
  const o3 = { tag: "s3." + p0.n, n: p0.n + 4, a: null, b: null };
  return p0;
}
function h1(p0, d) {
  if (p0.n % 61 === 7) throw p0;
  const l4 = [p0, p0];
  l4[0].a = p0;
  const r5 = h6.apply(null, [p0, p0, (v) => {
    if (v.n % 41 === 16) kept.push(p0);
    return v;
  }, d]);
  const r6 = h7(p0, d);
  p0.a = null;
  return r6;
}
function h2(p0, f0, d) {
  const t7 = bag.get(p0.n % 5) ?? null;
  const g8 = (v) => {
    p0.b = v;
    p0.a = p0;
    return { tag: "s7." + v.n, n: v.n + 9, a: null, b: null };
  };
  const g9 = first.bind(null, p0);
  const r10 = h4(p0, new Made("c8." + p0.n, p0.n + 1, null), (v) => {
    if (v.n % 71 === 7) slot = p0;
    return v;
  }, d);
  const r11 = f0(p0);
  return null;
}
function h3(p0, d) {
  const r12 = h7(p0, d);
  const r13 = h5(p0, p0, d);
  const g14 = first.bind(null, p0);
  try {
    if (p0.n % 53 === 6) kept.push(p0);
    if (p0.n % 61 === 6) throw p0;
  } finally {
    p0.a = p0;
  }
  const r15 = d > 0 ? h3({ tag: "s11." + p0.n, n: p0.n + 1, a: null, b: null }, d - 1) : null;
  let c16 = p0;
  for (let k = 0; k < 3; k++) c16 = c16.a ?? p0;
  return null;
}
function h4(p0, p1, f0, d) {
  let r17 = null;
  try {
    r17 = h6(p1, p0, (v) => {
      if (p0 === p1) p0.n += 1000;
      return { tag: "s13." + v.n, n: v.n + 4, a: null, b: null };
    }, d);
  } catch (e) {
    r17 = e;
  }
  const o18 = { tag: "s14." + p1.n, n: p1.n + 9, a: p0, b: null };
  if (o18.n % 61 === 25) throw p0;
  const r19 = d > 0 ? h4(p0, { tag: "s15." + p0.n, n: p0.n + 6, a: null, b: null }, (v) => {
    v.a = o18;
    return v;
  }, d - 1) : null;
  const r20 = h7(p0, d);
  if (p1.n % 37 === 0) throw p0;
  if (r20 !== null) {
    if (p0 === p0) p0.n += 1000;
  }
  if (o18.n % 37 === 10) keptFunctions.push(f0);
  return o18;
}
function h5(p0, p1, d) {
  let c21 = p1;
  for (let k = 0; k < 3; k++) c21 = c21.b ?? p0;
  const w22 = { tag: "s18." + p1.n, n: p1.n + 7, a: c21, b: null };
  w22.a.a = p0;
  const t23 = bag.get(c21.n % 5) ?? null;
  p0.n += 1;
  const l24 = [c21, p0];
  l24[1].a = p1;
  const t25 = bag.get(c21.n % 5) ?? null;
  const r26 = h7(c21, d);
  const o27 = { tag: "s19." + p1.n, n: p1.n + 7, a: p1, b: null };
  return o27;
}
function h6(p0, p1, f0, d) {
  bag.set(p0.n % 5, p1);
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 61 === 3) throw p0;
  } finally {
    if (p1.n % 31 === 11) slot = p0;
  }
  const t28 = p0.b;
  const l29 = [p1, p1];
  l29[1].a = p0;
  return t28;
}
function h7(p0, d) {
  let c30 = p0;
  for (let k = 0; k < 3; k++) c30 = c30.b ?? p0;
  const { a: t31 } = p0;
  if (t31 !== null) {
    c30.a = null;
  }
  return t31;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h3(o1, 1);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 89 === 28) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h2(o0, (v) => {
      o2.a = o0;
      return v;
    }, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 41 === 24) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h0(o2, (v) => {
      o2.a = null;
      return o1;
    }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 41 === 3) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h3(o1, 2);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 31 === 20) kept.push(r35);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r36 = h2({ tag: "s25." + o2.n, n: o2.n + 4, a: o2, b: null }, (v) => {
      v.b = o1;
      return null;
    }, 2);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 89 === 25) kept.push(r36);
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
