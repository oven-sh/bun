// Made by test/aot/generate-relations-at-random.ts, seed 61: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = first.bind(null, p1);
  const r1 = d > 0 ? h0({ tag: "s0." + p0.n, n: p0.n + 7, a: null, b: null }, new Made("c1." + p2.n, p2.n + 2, null), p1, d - 1) : null;
  const w2 = new Made("c2." + p1.n, p1.n + 2, p1);
  w2.a.b = p1;
  const r3 = g0(p0);
  for (const v of both(p2, p0)) {
    p0.b = null;
  }
  return p1;
}
function h1(p0, p1, p2, f0, d) {
  const g4 = (v) => {
    v.b = p1;
    v.b = v;
    v.n += 2;
    return p1;
  };
  const g5 = (v) => {
    if (p1.n % 71 === 26) kept.push(v);
    if (p0.n % 37 === 25) slot = p0;
    return p0;
  };
  const w6 = { tag: "s6." + p1.n, n: p1.n + 1, a: p0, b: null };
  w6.a.a = p1;
  const g7 = (v) => {
    if (p0.n % 53 === 29) kept.push(p1);
    return p0;
  };
  let r8 = null;
  try {
    r8 = h6({ tag: "s8." + p0.n, n: p0.n + 2, a: p1, b: null }, p2, d);
  } catch (e) {
    r8 = e;
  }
  const w9 = { tag: "s9." + p2.n, n: p2.n + 1, a: p1, b: null };
  w9.a.b = p2;
  const t10 = slot;
  return r8;
}
function h2(p0, d) {
  const r11 = d > 0 ? h2(p0, d - 1) : null;
  let r12 = null;
  try {
    r12 = h7(p0, p0, d);
  } catch (e) {
    r12 = e;
  }
  const l13 = [p0, p0];
  l13[1].b = p0;
  if (p0.n % 61 === 22) holder.hold(p0);
  const t14 = p0.a;
  let c15 = p0;
  for (let k = 0; k < 3; k++) c15 = c15.b ?? p0;
  if (r12 !== null) {
    if (c15 === r12) c15.n += 1000;
  }
  return t14;
}
function h3(p0, p1, f0, d) {
  let c16 = p1;
  for (let k = 0; k < 3; k++) c16 = c16.b ?? p0;
  const r17 = f0(p1);
  const t18 = p1.a;
  const w19 = { tag: "s12." + p1.n, n: p1.n + 9, a: p0, b: null };
  w19.a.a = c16;
  return p1;
}
function h4(p0, p1, d) {
  const c20 = p0.n % 2 === 0 ? p0 : p1;
  for (const v of both(c20, p1)) {
    if (p0.n % 89 === 27) kept.push(c20);
  }
  const c21 = p1.n % 2 === 0 ? p1 : p1;
  p1.b = p1;
  return c20;
}
function h5(p0, p1, d) {
  const o22 = { tag: "s15." + p1.n, n: p1.n + 1, a: p0, b: null };
  const o23 = new Made("c16." + p1.n, p1.n + 7, null);
  const r24 = h7(p0, o23, d);
  const w25 = { tag: "s17." + p1.n, n: p1.n + 5, a: o22, b: null };
  w25.a.a = p0;
  const t26 = o22.b;
  const t27 = bag.get(p1.n % 5) ?? null;
  let r28 = null;
  try {
    r28 = h6(p1, p0, d);
  } catch (e) {
    r28 = e;
  }
  return t26;
}
function h6(p0, p1, d) {
  const t29 = bag.get(p1.n % 5) ?? null;
  const r30 = h7(p0, { tag: "s19." + p1.n, n: p1.n + 8, a: p0, b: null }, d);
  const g31 = first.bind(null, p1);
  return p0;
}
function h7(p0, p1, d) {
  const l32 = [p1, p0];
  l32[0].b = p0;
  const w33 = { tag: "s21." + p0.n, n: p0.n + 7, a: p0, b: null };
  w33.a.a = p1;
  return { tag: "s22." + p1.n, n: p1.n + 9, a: p1, b: null };
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r34 = h1(o1, o1, o2, (v) => {
      if (v === v) v.n += 1000;
      if (o2.n % 89 === 18) slot = o0;
      return o2;
    }, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 31 === 18) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h1(o2, o1, new Made("c24." + o0.n, o0.n + 1, null), (v) => {
      o2.b = o2;
      o0.a = o1;
      if (v.n % 71 === 26) kept.push(o0);
      return v;
    }, 1);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 37 === 16) kept.push(r35);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r36 = h6(o0, { tag: "s26." + o0.n, n: o0.n + 9, a: o0, b: null }, 2);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 41 === 19) kept.push(r36);
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
