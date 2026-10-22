// Made by test/aot/generate-relations-at-random.ts, seed 43: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c0 = p0.n % 2 === 0 ? p0 : p0;
  let c1 = p0;
  for (let k = 0; k < 3; k++) c1 = c1.b ?? c0;
  if (p0.n % 71 === 15) slot = p0;
  return c1;
}
function h1(p0, f0, d) {
  const t2 = holder.take();
  if (p0.n % 71 === 24) keptFunctions.push(f0);
  const g3 = first.bind(null, p0);
  try {
    p0.a = p0;
    if (p0.n % 89 === 24) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const t4 = holder.take();
  for (const v of both(p0, p0)) {
    v.b = null;
  }
  const t5 = slot;
  return t4;
}
function h2(p0, p1, p2, f0, d) {
  if (p0.n % 37 === 9) slot = p2;
  const g6 = (v) => {
    if (v === v) v.n += 1000;
    if (p0.n % 37 === 13) slot = p1;
    return v;
  };
  const t7 = slot;
  const o8 = { tag: "s3." + p0.n, n: p0.n + 8, a: p1, b: null };
  bag.set(p0.n % 5, o8);
  let c9 = o8;
  for (let k = 0; k < 3; k++) c9 = c9.a ?? p2;
  const r10 = g6(c9);
  return t7;
}
function h3(p0, d) {
  const r11 = d > 0 ? h3(p0, d - 1) : null;
  try {
    p0.n += 5;
    if (p0.n % 53 === 14) throw p0;
  } finally {
    if (p0 === p0) p0.n += 1000;
  }
  const o12 = { tag: "s5." + p0.n, n: p0.n + 8, a: null, b: null };
  const c13 = o12.n % 2 === 0 ? o12 : p0;
  let c14 = o12;
  for (let k = 0; k < 3; k++) c14 = c14.b ?? p0;
  holder.hold(c14);
  return null;
}
function h4(p0, f0, d) {
  const r15 = h8(p0, { tag: "s7." + p0.n, n: p0.n + 9, a: null, b: null }, p0, d);
  if (p0.n % 89 === 24) keptFunctions.push(f0);
  if (r15 !== null) {
    if (r15.n % 37 === 24) kept.push(p0);
  }
  const r16 = h6.apply(null, [p0, d]);
  const t17 = holder.take();
  for (const v of both(p0, p0)) {
    p0.b = null;
  }
  return null;
}
function h5(p0, p1, p2, d) {
  const t18 = bag.get(p2.n % 5) ?? null;
  const t19 = holder.take();
  const r20 = h7(p0, (v) => {
    p0.n += 2;
    if (p1 === p1) p1.n += 1000;
    if (p0.n % 89 === 20) kept.push(p1);
    return p0;
  }, d);
  const o21 = new Made("c10." + p2.n, p2.n + 6, null);
  return t18;
}
function h6(p0, d) {
  const t22 = p0.a;
  const l23 = [p0, p0];
  l23[0].b = p0;
  if (p0.n % 71 === 29) throw p0;
  return null;
}
function h7(p0, f0, d) {
  const t24 = holder.take();
  const r25 = h9.apply(null, [p0, p0, p0, f0, d]);
  const t26 = bag.get(p0.n % 5) ?? null;
  const r27 = h9(p0, p0, p0, f0, d);
  return { tag: "s13." + p0.n, n: p0.n + 1, a: p0, b: null };
}
function h8(p0, p1, p2, d) {
  const r28 = h9(new Made("c14." + p2.n, p2.n + 7, p2), p1, p0, (v) => {
    v.b = null;
    p1.a = null;
    if (p2 === v) p2.n += 1000;
    return p2;
  }, d);
  const r29 = d > 0 ? h8(p0, { tag: "s16." + p1.n, n: p1.n + 4, a: p1, b: null }, p0, d - 1) : null;
  const r30 = h9(p2, p2, new Made("c17." + p1.n, p1.n + 2, p0), (v) => {
    p1.a = v;
    v.a = p2;
    return v;
  }, d);
  const g31 = first.bind(null, p2);
  const g32 = first.bind(null, p0);
  holder.hold(p1);
  try {
    p1.b = p0;
    if (p2.n % 71 === 24) throw p1;
  } finally {
    p2.a = p2;
  }
  return r29;
}
function h9(p0, p1, p2, f0, d) {
  const t33 = bag.get(p0.n % 5) ?? null;
  const c34 = p2.n % 2 === 0 ? p2 : p1;
  if (t33 !== null) {
    t33.a = c34;
  }
  const o35 = { tag: "s20." + p0.n, n: p0.n + 5, a: p0, b: null };
  try {
    if (o35.n % 61 === 23) slot = p1;
    if (c34.n % 41 === 8) throw p1;
  } finally {
    if (p0 === o35) p0.n += 1000;
  }
  if (p0 === c34) p0.n += 1000;
  if (c34.n % 61 === 29) holder.hold(p0);
  const c36 = p0.n % 2 === 0 ? p0 : o35;
  return c36;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r37 = h0(o2, 2);
    if (r37 !== null) {
      sum += r37.n;
      if (r37.n % 89 === 13) kept.push(r37);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r38 = h0(o0, 0);
    if (r38 !== null) {
      sum += r38.n;
      if (r38.n % 41 === 6) kept.push(r38);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r39 = h2(o0, { tag: "s22." + o0.n, n: o0.n + 7, a: o1, b: null }, o0, (v) => {
      v.b = v;
      return null;
    }, 0);
    if (r39 !== null) {
      sum += r39.n;
      if (r39.n % 31 === 0) kept.push(r39);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r40 = h5(o2, { tag: "s24." + o2.n, n: o2.n + 5, a: null, b: null }, o1, 1);
    if (r40 !== null) {
      sum += r40.n;
      if (r40.n % 71 === 4) kept.push(r40);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r41 = h9(o0, o2, { tag: "s25." + o2.n, n: o2.n + 8, a: o0, b: null }, (v) => {
      if (o2 === v) o2.n += 1000;
      v.a = o1;
      return v;
    }, 2);
    if (r41 !== null) {
      sum += r41.n;
      if (r41.n % 71 === 20) kept.push(r41);
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
