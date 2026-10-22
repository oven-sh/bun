// Made by test/aot/generate-relations-at-random.ts, seed 49: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const t0 = slot;
  try {
    p0.n += 5;
    if (p1.n % 53 === 10) throw p1;
  } finally {
    p0.n += 2;
  }
  if (p0.n % 31 === 23) slot = p0;
  const r1 = d > 0 ? h0(new Made("c0." + p1.n, p1.n + 8, p1), p1, d - 1) : null;
  const l2 = [p0, p1];
  l2[0].b = p1;
  let r3 = null;
  try {
    r3 = h3(p1, p1, new Made("c1." + p0.n, p0.n + 5, p0), (v) => {
      v.b = null;
      return null;
    }, d);
  } catch (e) {
    r3 = e;
  }
  for (const v of both(p0, p0)) {
    if (p0.n % 61 === 29) slot = p1;
  }
  const r4 = d > 0 ? h0(p1, p1, d - 1) : null;
  return r1;
}
function h1(p0, d) {
  const t5 = slot;
  if (t5 !== null) {
    if (t5.n % 61 === 12) slot = p0;
  }
  try {
    p0.b = p0;
    if (p0.n % 31 === 0) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const r6 = d > 0 ? h1(p0, d - 1) : null;
  const t7 = slot;
  let c8 = p0;
  for (let k = 0; k < 3; k++) c8 = c8.b ?? p0;
  const r9 = h2(p0, d);
  return p0;
}
function h2(p0, d) {
  holder.hold(p0);
  const t10 = bag.get(p0.n % 5) ?? null;
  if (p0.n % 89 === 14) slot = p0;
  const c11 = p0.n % 2 === 0 ? p0 : p0;
  return p0;
}
function h3(p0, p1, p2, f0, d) {
  const t12 = slot;
  if (t12 !== null) {
    t12.a = p1;
  }
  const w13 = { tag: "s6." + p2.n, n: p2.n + 4, a: p2, b: null };
  w13.a.a = p2;
  return p0;
}
function h4(p0, d) {
  bag.set(p0.n % 5, p0);
  bag.set(p0.n % 5, p0);
  const t14 = slot;
  const g15 = first.bind(null, p0);
  const w16 = new Made("c8." + p0.n, p0.n + 4, p0);
  w16.a.a = p0;
  if (p0.n % 41 === 8) slot = p0;
  return null;
}
function h5(p0, p1, d) {
  const g17 = first.bind(null, p1);
  if (p1.n % 31 === 13) keptFunctions.push(g17);
  const r18 = g17(p1);
  const r19 = g17(p1);
  const t20 = bag.get(p0.n % 5) ?? null;
  const t21 = slot;
  try {
    if (p0.n % 61 === 0) kept.push(p1);
    if (p0.n % 61 === 2) throw p1;
  } finally {
    p0.a = p1;
  }
  return new Made("c10." + p0.n, p0.n + 8, p0);
}
function h6(p0, f0, d) {
  try {
    p0.b = null;
    if (p0.n % 41 === 12) throw p0;
  } finally {
    p0.a = p0;
  }
  holder.hold(p0);
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r22 = h1(o2, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 28) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h6(o1, (v) => {
      o1.n += 4;
      if (o1 === o0) o1.n += 1000;
      o2.n += 1;
      return o1;
    }, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 53 === 17) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h6(o1, (v) => {
      if (o0.n % 37 === 20) kept.push(o0);
      return new Made("c13." + v.n, v.n + 2, v);
    }, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 53 === 1) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h5(o0, o1, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 61 === 22) kept.push(r25);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r26 = h0(o1, { tag: "s14." + o0.n, n: o0.n + 4, a: null, b: null }, 1);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 37 === 11) kept.push(r26);
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
