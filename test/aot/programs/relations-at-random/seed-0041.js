// Made by test/aot/generate-relations-at-random.ts, seed 41: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, d) {
  const r0 = h5(p0, (v) => {
    if (p0 === p0) p0.n += 1000;
    if (p1.n % 37 === 21) slot = p1;
    p1.a = p1;
    return { tag: "s0." + v.n, n: v.n + 3, a: v, b: null };
  }, d);
  const { a: t1 } = p1;
  p0.b = null;
  const o2 = { tag: "s1." + p0.n, n: p0.n + 9, a: p0, b: null };
  try {
    if (p0.n % 61 === 8) kept.push(p1);
    if (o2.n % 37 === 27) throw p1;
  } finally {
    p1.b = p0;
  }
  const r3 = h4(p0, o2, o2, d);
  return p0;
}
function h1(p0, p1, d) {
  p0.n += 1;
  const t4 = slot;
  const w5 = { tag: "s3." + p0.n, n: p0.n + 8, a: p1, b: null };
  w5.a.a = p1;
  const g6 = (v) => {
    v.b = p0;
    p1.a = v;
    v.a = p1;
    return v;
  };
  let c7 = p1;
  for (let k = 0; k < 3; k++) c7 = c7.b ?? p1;
  const o8 = { tag: "s5." + p1.n, n: p1.n + 9, a: null, b: null };
  for (const v of both(o8, p0)) {
    p1.b = o8;
  }
  const l9 = [o8, p0];
  l9[0].a = c7;
  return null;
}
function h2(p0, p1, d) {
  const c10 = p1.n % 2 === 0 ? p1 : p1;
  const t11 = p0.a;
  const o12 = { tag: "s7." + p0.n, n: p0.n + 3, a: p0, b: null };
  const t13 = bag.get(p1.n % 5) ?? null;
  if (t11 !== null) {
    o12.b = o12;
  }
  for (const v of both(p1, c10)) {
    if (p0 === o12) p0.n += 1000;
  }
  return o12;
}
function h3(p0, p1, f0, d) {
  const r14 = h6.apply(null, [p0, p1, p0, d]);
  const c15 = p1.n % 2 === 0 ? p1 : p0;
  const o16 = new Made("c9." + c15.n, c15.n + 3, p0);
  const r17 = h8(c15, o16, { tag: "s10." + o16.n, n: o16.n + 1, a: c15, b: null }, d);
  const g18 = (v) => {
    if (p0.n % 41 === 27) kept.push(c15);
    if (o16.n % 53 === 0) slot = p1;
    return v;
  };
  bag.set(o16.n % 5, o16);
  return p0;
}
function h4(p0, p1, p2, d) {
  const r19 = d > 0 ? h4(p2, p2, p1, d - 1) : null;
  const r20 = h6(p0, p2, p1, d);
  const { a: t21 } = p1;
  bag.set(p0.n % 5, p1);
  const l22 = [p2, p0];
  l22[1].a = p0;
  return new Made("c13." + p0.n, p0.n + 7, null);
}
function h5(p0, f0, d) {
  const g23 = first.bind(null, p0);
  const c24 = p0.n % 2 === 0 ? p0 : p0;
  const r25 = h7(p0, (v) => {
    c24.n += 2;
    v.n += 3;
    c24.b = null;
    return v;
  }, d);
  const w26 = { tag: "s15." + c24.n, n: c24.n + 9, a: p0, b: null };
  w26.a.a = c24;
  const t27 = slot;
  const g28 = (v) => {
    if (v === v) v.n += 1000;
    return { tag: "s16." + v.n, n: v.n + 3, a: null, b: null };
  };
  bag.set(c24.n % 5, p0);
  let c29 = c24;
  for (let k = 0; k < 3; k++) c29 = c29.a ?? c24;
  return c24;
}
function h6(p0, p1, p2, d) {
  let r30 = null;
  try {
    r30 = h7(p0, (v) => {
      if (p2.n % 37 === 20) kept.push(p2);
      return { tag: "s18." + v.n, n: v.n + 2, a: v, b: null };
    }, d);
  } catch (e) {
    r30 = e;
  }
  if (p2.n % 61 === 24) throw p2;
  let c31 = p2;
  for (let k = 0; k < 3; k++) c31 = c31.b ?? p2;
  const t32 = p2.b;
  const l33 = [p0, p0];
  l33[1].a = p0;
  const t34 = holder.take();
  return t32;
}
function h7(p0, f0, d) {
  if (p0.n % 53 === 4) throw p0;
  const r35 = f0(p0);
  try {
    p0.b = p0;
    if (p0.n % 41 === 26) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const r36 = h9.apply(null, [p0, f0, d]);
  const l37 = [p0, p0];
  l37[0].b = p0;
  const r38 = d > 0 ? h7(p0, (v) => {
    if (v.n % 41 === 13) kept.push(v);
    v.a = v;
    return { tag: "s20." + v.n, n: v.n + 2, a: null, b: null };
  }, d - 1) : null;
  p0.n += 5;
  return r36;
}
function h8(p0, p1, p2, d) {
  const r39 = h9(p1, (v) => {
    if (p1 === p0) p1.n += 1000;
    p1.a = p1;
    return p1;
  }, d);
  if (p2.n % 41 === 29) throw p1;
  const r40 = h9.call(null, p1, (v) => {
    v.n += 2;
    v.a = p1;
    v.b = null;
    return p1;
  }, d);
  const l41 = [p0, p0];
  l41[0].b = p2;
  return p0;
}
function h9(p0, f0, d) {
  const w42 = { tag: "s25." + p0.n, n: p0.n + 1, a: p0, b: null };
  w42.a.b = p0;
  const r43 = f0(p0);
  const l44 = [p0, p0];
  l44[1].a = p0;
  bag.set(p0.n % 5, p0);
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r45 = h4({ tag: "s27." + o0.n, n: o0.n + 3, a: o0, b: null }, o1, o1, 1);
    if (r45 !== null) {
      sum += r45.n;
      if (r45.n % 31 === 23) kept.push(r45);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r46 = h4(o0, new Made("c28." + o1.n, o1.n + 2, o1), o1, 2);
    if (r46 !== null) {
      sum += r46.n;
      if (r46.n % 61 === 9) kept.push(r46);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r47 = h0(o2, o0, 0);
    if (r47 !== null) {
      sum += r47.n;
      if (r47.n % 89 === 2) kept.push(r47);
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
