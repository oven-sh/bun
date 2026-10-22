// Made by test/aot/generate-relations-at-random.ts, seed 29: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = first.bind(null, p0);
  const g1 = (v) => {
    p0.a = p0;
    if (v.n % 37 === 9) kept.push(p0);
    return v;
  };
  bag.set(p0.n % 5, p0);
  const o2 = { tag: "s1." + p0.n, n: p0.n + 3, a: p0, b: null };
  const l3 = [p0, o2];
  l3[0].a = o2;
  return p0;
}
function h1(p0, f0, d) {
  const l4 = [p0, p0];
  l4[0].b = p0;
  const t5 = bag.get(p0.n % 5) ?? null;
  const t6 = bag.get(p0.n % 5) ?? null;
  const l7 = [p0, p0];
  l7[1].a = p0;
  const r8 = h6.call(null, p0, { tag: "s3." + p0.n, n: p0.n + 4, a: p0, b: null }, p0, d);
  const r9 = h5(p0, d);
  if (p0.n % 89 === 7) slot = p0;
  return null;
}
function h2(p0, p1, f0, d) {
  const r10 = f0(p1);
  if (p1.n % 37 === 9) keptFunctions.push(f0);
  const g11 = (v) => {
    if (v === p0) v.n += 1000;
    if (p0 === p1) p0.n += 1000;
    p1.n += 1;
    return { tag: "s5." + v.n, n: v.n + 3, a: v, b: null };
  };
  const r12 = g11(p0);
  const o13 = { tag: "s6." + p1.n, n: p1.n + 6, a: null, b: null };
  const t14 = holder.take();
  const c15 = p0.n % 2 === 0 ? p0 : p0;
  return t14;
}
function h3(p0, f0, d) {
  if (p0.n % 41 === 13) holder.hold(p0);
  try {
    p0.a = null;
    if (p0.n % 41 === 21) throw p0;
  } finally {
    p0.b = p0;
  }
  const g16 = (v) => {
    if (v.n % 53 === 6) slot = v;
    p0.b = null;
    return p0;
  };
  let r17 = null;
  try {
    r17 = h5(p0, d);
  } catch (e) {
    r17 = e;
  }
  const t18 = holder.take();
  if (p0.n % 37 === 19) throw p0;
  return p0;
}
function h4(p0, d) {
  const t19 = bag.get(p0.n % 5) ?? null;
  let r20 = null;
  try {
    r20 = h6(p0, p0, p0, d);
  } catch (e) {
    r20 = e;
  }
  const c21 = p0.n % 2 === 0 ? p0 : p0;
  const t22 = slot;
  if (c21.n % 37 === 29) throw p0;
  const t23 = p0.a;
  const g24 = (v) => {
    p0.b = p0;
    return v;
  };
  const l25 = [c21, p0];
  l25[0].b = c21;
  return null;
}
function h5(p0, d) {
  if (p0.n % 71 === 17) throw p0;
  if (p0 === p0) p0.n += 1000;
  if (p0.n % 37 === 20) throw p0;
  const t26 = holder.take();
  return t26;
}
function h6(p0, p1, p2, d) {
  const g27 = (v) => {
    if (p1.n % 61 === 25) kept.push(v);
    p2.n += 4;
    p2.n += 2;
    return { tag: "s13." + v.n, n: v.n + 5, a: p0, b: null };
  };
  const w28 = new Made("c14." + p1.n, p1.n + 2, p1);
  w28.a.b = p0;
  const o29 = { tag: "s15." + p0.n, n: p0.n + 2, a: p0, b: null };
  p0.a = p1;
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h1(o2, (v) => {
      v.b = o0;
      if (v === o0) v.n += 1000;
      return null;
    }, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 61 === 19) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h3(o2, (v) => {
      o1.a = null;
      o1.n += 5;
      return o1;
    }, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 18) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h3(o2, (v) => {
      o2.b = null;
      o0.a = null;
      v.b = v;
      return o0;
    }, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 89 === 27) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h2(o0, new Made("c20." + o0.n, o0.n + 4, o2), (v) => {
      o1.b = o1;
      return v;
    }, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 5) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h0(o1, (v) => {
      if (o0 === o0) o0.n += 1000;
      if (v.n % 53 === 12) kept.push(o1);
      if (v === v) v.n += 1000;
      return v;
    }, 0);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 71 === 27) kept.push(r34);
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
