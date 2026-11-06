// Flags: --aot-validate
// Made by test/aot/generate-relations-at-random.ts, seed 55: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const t0 = slot;
  bag.set(p2.n % 5, p0);
  return t0;
}
function h1(p0, p1, p2, f0, d) {
  const g1 = first.bind(null, p0);
  for (const v of both(p2, p0)) {
    p2.a = null;
  }
  const w2 = { tag: "s1." + p1.n, n: p1.n + 7, a: p2, b: null };
  w2.a.a = p2;
  const t3 = slot;
  try {
    p1.a = p1;
    if (p1.n % 61 === 20) throw p1;
  } finally {
    p1.a = p1;
  }
  return null;
}
function h2(p0, d) {
  const l4 = [p0, p0];
  l4[1].b = p0;
  const g5 = (v) => {
    p0.a = null;
    v.b = v;
    return v;
  };
  const o6 = { tag: "s4." + p0.n, n: p0.n + 7, a: p0, b: null };
  const t7 = holder.take();
  const t8 = o6.a;
  if (o6.n % 31 === 7) keptFunctions.push(g5);
  let c9 = p0;
  for (let k = 0; k < 3; k++) c9 = c9.b ?? p0;
  return c9;
}
function h3(p0, d) {
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 31 === 17) throw p0;
  } finally {
    p0.b = null;
  }
  const t10 = slot;
  const w11 = new Made("c6." + p0.n, p0.n + 9, p0);
  w11.a.b = p0;
  return t10;
}
function h4(p0, d) {
  const r12 = h7.apply(null, [p0, new Made("c8." + p0.n, p0.n + 4, null), (v) => {
    v.n += 2;
    p0.b = null;
    return { tag: "s9." + v.n, n: v.n + 5, a: v, b: null };
  }, d]);
  const o13 = { tag: "s10." + p0.n, n: p0.n + 4, a: null, b: null };
  const o14 = new Made("c11." + p0.n, p0.n + 4, null);
  const o15 = { tag: "s12." + o13.n, n: o13.n + 5, a: null, b: null };
  return o14;
}
function h5(p0, p1, f0, d) {
  const r16 = d > 0 ? h5(p1, p0, (v) => {
    v.a = null;
    return null;
  }, d - 1) : null;
  const g17 = first.bind(null, p0);
  const l18 = [p0, p1];
  l18[1].a = p0;
  const t19 = p1.a;
  bag.set(p0.n % 5, p1);
  const r20 = h7(new Made("c15." + p0.n, p0.n + 2, null), p1, (v) => {
    v.n += 5;
    if (v.n % 41 === 5) kept.push(v);
    p0.a = null;
    return v;
  }, d);
  const g21 = (v) => {
    if (v.n % 53 === 14) kept.push(v);
    p0.a = null;
    p0.a = v;
    return { tag: "s17." + v.n, n: v.n + 4, a: v, b: null };
  };
  return t19;
}
function h6(p0, d) {
  const r22 = d > 0 ? h6(p0, d - 1) : null;
  const w23 = { tag: "s19." + p0.n, n: p0.n + 9, a: p0, b: null };
  w23.a.a = p0;
  const c24 = p0.n % 2 === 0 ? p0 : p0;
  const r25 = h7.apply(null, [c24, p0, (v) => {
    p0.n += 3;
    c24.b = null;
    if (c24.n % 61 === 24) kept.push(v);
    return v;
  }, d]);
  try {
    if (p0.n % 71 === 12) kept.push(p0);
    if (p0.n % 61 === 20) throw c24;
  } finally {
    p0.a = c24;
  }
  return null;
}
function h7(p0, p1, f0, d) {
  const g26 = first.bind(null, p0);
  const o27 = { tag: "s22." + p1.n, n: p1.n + 5, a: p1, b: null };
  const o28 = { tag: "s23." + o27.n, n: o27.n + 9, a: p0, b: null };
  const w29 = { tag: "s24." + p0.n, n: p0.n + 5, a: p1, b: null };
  w29.a.b = p1;
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h4({ tag: "s26." + o2.n, n: o2.n + 2, a: null, b: null }, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 3) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h4(o0, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 89 === 5) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h5({ tag: "s27." + o2.n, n: o2.n + 6, a: o1, b: null }, o2, (v) => {
      v.a = o2;
      o2.b = o2;
      return { tag: "s28." + v.n, n: v.n + 1, a: o2, b: null };
    }, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 31 === 23) kept.push(r32);
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
