// Made by test/aot/generate-relations-at-random.ts, seed 67: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0.n % 31 === 25) throw p1;
  const { b: t0 } = p1;
  const r1 = d > 0 ? h0({ tag: "s0." + p0.n, n: p0.n + 8, a: null, b: null }, p0, d - 1) : null;
  let c2 = p1;
  for (let k = 0; k < 3; k++) c2 = c2.b ?? p1;
  const r3 = d > 0 ? h0(p1, c2, d - 1) : null;
  return t0;
}
function h1(p0, p1, f0, d) {
  const r4 = h8(new Made("c2." + p1.n, p1.n + 1, p0), (v) => {
    v.b = p0;
    v.b = null;
    p0.b = p1;
    return { tag: "s3." + v.n, n: v.n + 7, a: p0, b: null };
  }, d);
  if (p0.n % 41 === 9) keptFunctions.push(f0);
  let c5 = p0;
  for (let k = 0; k < 3; k++) c5 = c5.b ?? p1;
  let r6 = null;
  try {
    r6 = h8({ tag: "s4." + p0.n, n: p0.n + 2, a: null, b: null }, (v) => {
      c5.a = v;
      return v;
    }, d);
  } catch (e) {
    r6 = e;
  }
  const r7 = h9(p1, p1, d);
  const t8 = slot;
  const r9 = h2(p1, { tag: "s6." + p1.n, n: p1.n + 7, a: p1, b: null }, c5, d);
  if (r6 !== null) {
    if (r6 === p0) r6.n += 1000;
  }
  return r6;
}
function h2(p0, p1, p2, d) {
  const l10 = [p1, p1];
  l10[0].a = p0;
  const c11 = p2.n % 2 === 0 ? p2 : p1;
  const o12 = { tag: "s8." + p1.n, n: p1.n + 5, a: c11, b: null };
  return null;
}
function h3(p0, p1, d) {
  p1.b = p0;
  try {
    p0.b = null;
    if (p1.n % 61 === 6) throw p1;
  } finally {
    if (p1.n % 41 === 17) slot = p1;
  }
  const r13 = d > 0 ? h3(p1, p0, d - 1) : null;
  return { tag: "s10." + p0.n, n: p0.n + 2, a: p1, b: null };
}
function h4(p0, d) {
  const t14 = slot;
  const w15 = new Made("c11." + p0.n, p0.n + 6, p0);
  w15.a.a = p0;
  if (p0.n % 41 === 20) throw p0;
  return null;
}
function h5(p0, p1, d) {
  if (p0.n % 89 === 4) holder.hold(p1);
  try {
    if (p0.n % 89 === 16) kept.push(p1);
    if (p0.n % 31 === 3) throw p1;
  } finally {
    p1.b = p1;
  }
  const t16 = bag.get(p0.n % 5) ?? null;
  for (const v of both(p1, p1)) {
    if (p0.n % 41 === 0) kept.push(v);
  }
  const t17 = holder.take();
  for (const v of both(p1, p0)) {
    p1.n += 2;
  }
  return t17;
}
function h6(p0, f0, d) {
  const r18 = h8.call(null, p0, f0, d);
  bag.set(p0.n % 5, p0);
  const l19 = [p0, p0];
  l19[1].b = p0;
  const t20 = bag.get(p0.n % 5) ?? null;
  const w21 = { tag: "s14." + p0.n, n: p0.n + 5, a: p0, b: null };
  w21.a.b = p0;
  const r22 = h9.apply(null, [p0, { tag: "s15." + p0.n, n: p0.n + 4, a: p0, b: null }, d]);
  return r18;
}
function h7(p0, p1, d) {
  const t23 = bag.get(p0.n % 5) ?? null;
  const t24 = bag.get(p0.n % 5) ?? null;
  const t25 = holder.take();
  if (p1.n % 89 === 24) kept.push(p1);
  const o26 = { tag: "s17." + p0.n, n: p0.n + 7, a: p0, b: null };
  return p0;
}
function h8(p0, f0, d) {
  const r27 = h9(p0, { tag: "s19." + p0.n, n: p0.n + 5, a: null, b: null }, d);
  const { a: t28 } = p0;
  for (const v of both(p0, p0)) {
    if (p0 === p0) p0.n += 1000;
  }
  return null;
}
function h9(p0, p1, d) {
  const t29 = bag.get(p0.n % 5) ?? null;
  bag.set(p1.n % 5, p0);
  let c30 = p0;
  for (let k = 0; k < 3; k++) c30 = c30.a ?? p0;
  if (p1.n % 89 === 15) throw c30;
  const t31 = bag.get(p0.n % 5) ?? null;
  const w32 = new Made("c21." + c30.n, c30.n + 2, c30);
  w32.a.a = c30;
  if (t31 !== null) {
    c30.b = null;
  }
  if (c30.n % 31 === 3) throw c30;
  return p1;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r33 = h1(new Made("c23." + o2.n, o2.n + 8, null), o1, (v) => {
      o2.n += 1;
      o2.b = v;
      return o1;
    }, 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 89 === 8) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h2(new Made("c25." + o0.n, o0.n + 4, o2), o1, o1, 0);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 61 === 13) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h4(o2, 1);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 53 === 18) kept.push(r35);
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
