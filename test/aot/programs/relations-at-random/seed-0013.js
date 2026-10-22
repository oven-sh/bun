// Made by test/aot/generate-relations-at-random.ts, seed 13: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, f0, d) {
  const l0 = [p0, p1];
  l0[1].a = p0;
  const o1 = new Made("c0." + p1.n, p1.n + 1, p0);
  if (p0.n % 71 === 6) throw o1;
  for (const v of both(p1, p0)) {
    p0.a = o1;
  }
  const r2 = h2(p0, f0, d);
  const r3 = f0(p0);
  return p0;
}
function h1(p0, f0, d) {
  const r4 = h6(p0, d);
  for (const v of both(p0, p0)) {
    if (v === v) v.n += 1000;
  }
  if (p0.n % 71 === 16) keptFunctions.push(f0);
  const r5 = d > 0 ? h1(p0, f0, d - 1) : null;
  const r6 = h7(p0, p0, d);
  const r7 = h4(p0, { tag: "s2." + p0.n, n: p0.n + 8, a: null, b: null }, p0, d);
  if (p0.n % 37 === 25) keptFunctions.push(f0);
  return p0;
}
function h2(p0, f0, d) {
  const r8 = h3(p0, p0, d);
  if (p0.n % 89 === 29) keptFunctions.push(f0);
  const { b: t9 } = p0;
  if (p0.n % 61 === 22) keptFunctions.push(f0);
  const l10 = [p0, p0];
  l10[1].b = p0;
  const g11 = (v) => {
    if (p0.n % 71 === 28) kept.push(v);
    if (p0.n % 71 === 18) slot = v;
    if (p0 === p0) p0.n += 1000;
    return p0;
  };
  if (p0.n % 89 === 28) slot = p0;
  if (p0.n % 37 === 18) keptFunctions.push(g11);
  return { tag: "s5." + p0.n, n: p0.n + 5, a: p0, b: null };
}
function h3(p0, p1, d) {
  let r12 = null;
  try {
    r12 = h5(new Made("c6." + p1.n, p1.n + 9, p1), p1, p0, (v) => {
      if (v.n % 61 === 8) kept.push(p0);
      v.n += 1;
      if (p0.n % 31 === 19) kept.push(p1);
      return p1;
    }, d);
  } catch (e) {
    r12 = e;
  }
  bag.set(p0.n % 5, p0);
  try {
    p1.a = p1;
    if (p1.n % 31 === 4) throw p1;
  } finally {
    p0.b = p0;
  }
  try {
    p0.b = p0;
    if (p1.n % 89 === 16) throw p1;
  } finally {
    p1.b = p1;
  }
  return r12;
}
function h4(p0, p1, p2, d) {
  let r13 = null;
  try {
    r13 = h6(p0, d);
  } catch (e) {
    r13 = e;
  }
  const o14 = { tag: "s9." + p0.n, n: p0.n + 5, a: null, b: null };
  const t15 = bag.get(p0.n % 5) ?? null;
  const w16 = { tag: "s10." + p1.n, n: p1.n + 4, a: o14, b: null };
  w16.a.a = p1;
  const l17 = [o14, o14];
  l17[0].a = p1;
  for (const v of both(p0, o14)) {
    if (p2.n % 53 === 10) slot = o14;
  }
  return t15;
}
function h5(p0, p1, p2, f0, d) {
  const r18 = h6.apply(null, [p1, d]);
  for (const v of both(p1, p1)) {
    if (p0 === p1) p0.n += 1000;
  }
  const r19 = h6.call(null, p1, d);
  try {
    p1.n += 3;
    if (p1.n % 53 === 12) throw p2;
  } finally {
    p0.a = p1;
  }
  if (p1.n % 53 === 13) keptFunctions.push(f0);
  return null;
}
function h6(p0, d) {
  if (p0.n % 31 === 1) holder.hold(p0);
  p0.n += 4;
  p0.n += 5;
  const { a: t20 } = p0;
  const l21 = [p0, p0];
  l21[0].a = p0;
  const t22 = holder.take();
  if (p0.n % 31 === 20) throw p0;
  return t22;
}
function h7(p0, p1, d) {
  const t23 = holder.take();
  p1.n += 2;
  if (p0.n % 61 === 28) kept.push(p1);
  const o24 = { tag: "s14." + p0.n, n: p0.n + 9, a: null, b: null };
  return o24;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r25 = h4(o2, { tag: "s16." + o1.n, n: o1.n + 2, a: null, b: null }, o2, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 37 === 27) kept.push(r25);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r26 = h5(o2, o2, o0, (v) => {
      o0.b = null;
      if (o2 === o2) o2.n += 1000;
      return o0;
    }, 0);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 71 === 19) kept.push(r26);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r27 = h6(o0, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 41 === 6) kept.push(r27);
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
