// Flags: --aot-validate
// Made by test/aot/generate-relations-at-random.ts, seed 71: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  p0.a = p0;
  const r0 = h1.call(null, p0, p0, { tag: "s0." + p0.n, n: p0.n + 6, a: p0, b: null }, d);
  if (p0.n % 71 === 14) throw p0;
  p0.a = p0;
  const g1 = (v) => {
    if (p0.n % 37 === 16) slot = p0;
    return p0;
  };
  let r2 = null;
  try {
    r2 = h4(p0, p0, d);
  } catch (e) {
    r2 = e;
  }
  return null;
}
function h1(p0, p1, p2, d) {
  const w3 = { tag: "s3." + p1.n, n: p1.n + 4, a: p2, b: null };
  w3.a.b = p1;
  bag.set(p0.n % 5, p0);
  let r4 = null;
  try {
    r4 = h2(p2, (v) => {
      if (v.n % 37 === 19) kept.push(p1);
      if (v.n % 71 === 27) kept.push(p0);
      v.b = null;
      return null;
    }, d);
  } catch (e) {
    r4 = e;
  }
  const r5 = h7(p0, p2, d);
  const r6 = d > 0 ? h1(p2, p0, p0, d - 1) : null;
  const t7 = bag.get(p1.n % 5) ?? null;
  const { b: t8 } = p1;
  return r5;
}
function h2(p0, f0, d) {
  const r9 = h7(p0, p0, d);
  for (const v of both(p0, p0)) {
    v.b = p0;
  }
  bag.set(p0.n % 5, p0);
  const r10 = h8.apply(null, [p0, { tag: "s6." + p0.n, n: p0.n + 3, a: p0, b: null }, d]);
  for (const v of both(p0, p0)) {
    v.a = v;
  }
  const g11 = first.bind(null, p0);
  const r12 = d > 0 ? h2(p0, (v) => {
    p0.a = p0;
    v.a = null;
    if (p0 === v) p0.n += 1000;
    return v;
  }, d - 1) : null;
  return p0;
}
function h3(p0, p1, p2, f0, d) {
  holder.hold(p0);
  if (p0.n % 31 === 15) throw p0;
  const r13 = h7(p1, p2, d);
  const w14 = { tag: "s9." + p2.n, n: p2.n + 8, a: p0, b: null };
  w14.a.b = p1;
  let r15 = null;
  try {
    r15 = h4({ tag: "s10." + p1.n, n: p1.n + 5, a: p1, b: null }, p1, d);
  } catch (e) {
    r15 = e;
  }
  if (p0.n % 41 === 19) throw p2;
  const o16 = new Made("c11." + p0.n, p0.n + 8, p2);
  const g17 = first.bind(null, o16);
  return r13;
}
function h4(p0, p1, d) {
  const w18 = { tag: "s13." + p0.n, n: p0.n + 6, a: p0, b: null };
  w18.a.a = p1;
  bag.set(p1.n % 5, p1);
  const r19 = d > 0 ? h4(p1, p0, d - 1) : null;
  const r20 = d > 0 ? h4(p0, p1, d - 1) : null;
  const w21 = { tag: "s14." + p1.n, n: p1.n + 4, a: p1, b: null };
  w21.a.b = p1;
  return null;
}
function h5(p0, p1, p2, d) {
  const r22 = d > 0 ? h5(p2, p2, p1, d - 1) : null;
  if (r22 !== null) {
    p2.n += 2;
  }
  const g23 = (v) => {
    if (p0.n % 37 === 29) slot = p0;
    return { tag: "s16." + v.n, n: v.n + 4, a: null, b: null };
  };
  return { tag: "s17." + p0.n, n: p0.n + 1, a: p1, b: null };
}
function h6(p0, p1, d) {
  const g24 = (v) => {
    p0.n += 4;
    return null;
  };
  const t25 = slot;
  const r26 = h8.call(null, new Made("c19." + p0.n, p0.n + 5, null), p0, d);
  const r27 = h8(p0, p1, d);
  return t25;
}
function h7(p0, p1, d) {
  const r28 = h8(p0, new Made("c21." + p1.n, p1.n + 3, p0), d);
  const w29 = { tag: "s22." + p0.n, n: p0.n + 2, a: p0, b: null };
  w29.a.a = p1;
  if (r28 !== null) {
    if (r28.n % 53 === 24) slot = p1;
  }
  bag.set(p1.n % 5, p1);
  return null;
}
function h8(p0, p1, d) {
  const c30 = p1.n % 2 === 0 ? p1 : p0;
  const w31 = { tag: "s24." + p1.n, n: p1.n + 1, a: p1, b: null };
  w31.a.a = p1;
  if (p0.n % 71 === 20) throw c30;
  const l32 = [c30, c30];
  l32[1].b = p0;
  if (p0.n % 31 === 8) throw c30;
  for (const v of both(c30, p1)) {
    if (p0.n % 89 === 27) slot = c30;
  }
  const t33 = slot;
  const t34 = bag.get(c30.n % 5) ?? null;
  return p1;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r35 = h3(o0, { tag: "s26." + o1.n, n: o1.n + 3, a: o0, b: null }, o2, (v) => {
      o2.a = null;
      if (o0 === o0) o0.n += 1000;
      return v;
    }, 2);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 41 === 10) kept.push(r35);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r36 = h1(new Made("c28." + o0.n, o0.n + 3, o2), o2, o0, 2);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 71 === 3) kept.push(r36);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r37 = h5(o2, o0, o0, 0);
    if (r37 !== null) {
      sum += r37.n;
      if (r37.n % 53 === 27) kept.push(r37);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r38 = h5(o2, o1, new Made("c29." + o1.n, o1.n + 6, o2), 2);
    if (r38 !== null) {
      sum += r38.n;
      if (r38.n % 41 === 5) kept.push(r38);
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
