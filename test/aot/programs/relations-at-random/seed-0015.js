// Made by test/aot/generate-relations-at-random.ts, seed 15: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const g0 = first.bind(null, p0);
  let r1 = null;
  try {
    r1 = h1(p0, p0, (v) => {
      if (p0 === v) p0.n += 1000;
      p0.b = p0;
      return { tag: "s0." + v.n, n: v.n + 6, a: v, b: null };
    }, d);
  } catch (e) {
    r1 = e;
  }
  const r2 = d > 0 ? h0(new Made("c1." + p1.n, p1.n + 8, null), p0, d - 1) : null;
  return p0;
}
function h1(p0, p1, f0, d) {
  const r3 = f0(p0);
  const r4 = d > 0 ? h1(p0, p1, (v) => {
    if (p1.n % 53 === 23) kept.push(v);
    if (p1.n % 89 === 13) slot = p1;
    return v;
  }, d - 1) : null;
  if (p1.n % 53 === 23) throw p0;
  const r5 = f0(p0);
  let r6 = null;
  try {
    r6 = h6(p0, { tag: "s4." + p1.n, n: p1.n + 5, a: p0, b: null }, { tag: "s5." + p0.n, n: p0.n + 3, a: p1, b: null }, (v) => {
      if (v === p0) v.n += 1000;
      if (v.n % 37 === 20) slot = v;
      return v;
    }, d);
  } catch (e) {
    r6 = e;
  }
  const w7 = new Made("c7." + p0.n, p0.n + 3, p0);
  w7.a.b = p1;
  if (r5 !== null) {
    p0.n += 1;
  }
  const g8 = first.bind(null, p0);
  return p0;
}
function h2(p0, p1, d) {
  const r9 = d > 0 ? h2(p0, p0, d - 1) : null;
  const r10 = h4.call(null, p0, p0, (v) => {
    v.a = v;
    if (v.n % 41 === 10) slot = v;
    return v;
  }, d);
  const g11 = first.bind(null, p0);
  let c12 = p0;
  for (let k = 0; k < 3; k++) c12 = c12.b ?? p1;
  const r13 = h6(c12, p1, p1, (v) => {
    p0.a = p0;
    p1.n += 4;
    return p1;
  }, d);
  return new Made("c11." + p0.n, p0.n + 8, c12);
}
function h3(p0, f0, d) {
  p0.b = p0;
  const w14 = new Made("c12." + p0.n, p0.n + 7, p0);
  w14.a.b = p0;
  const r15 = h6(p0, p0, p0, (v) => {
    if (p0 === v) p0.n += 1000;
    return new Made("c13." + v.n, v.n + 2, null);
  }, d);
  if (p0.n % 71 === 11) keptFunctions.push(f0);
  const l16 = [p0, p0];
  l16[1].b = p0;
  return p0;
}
function h4(p0, p1, f0, d) {
  if (p0.n % 53 === 24) holder.hold(p1);
  const t17 = bag.get(p1.n % 5) ?? null;
  const t18 = p1.b;
  const t19 = p0.b;
  const t20 = bag.get(p1.n % 5) ?? null;
  const t21 = holder.take();
  if (p0.n % 37 === 3) kept.push(p0);
  return t19;
}
function h5(p0, f0, d) {
  const r22 = h6(p0, { tag: "s16." + p0.n, n: p0.n + 4, a: null, b: null }, { tag: "s17." + p0.n, n: p0.n + 2, a: null, b: null }, (v) => {
    v.n += 4;
    p0.a = v;
    v.n += 2;
    return v;
  }, d);
  const w23 = new Made("c19." + p0.n, p0.n + 9, p0);
  w23.a.a = p0;
  let c24 = p0;
  for (let k = 0; k < 3; k++) c24 = c24.b ?? p0;
  const t25 = bag.get(p0.n % 5) ?? null;
  c24.a = null;
  const r26 = h6(c24, p0, c24, f0, d);
  bag.set(p0.n % 5, p0);
  return new Made("c20." + c24.n, c24.n + 4, p0);
}
function h6(p0, p1, p2, f0, d) {
  bag.set(p0.n % 5, p1);
  const g27 = first.bind(null, p2);
  for (const v of both(p1, p1)) {
    v.a = p0;
  }
  p2.b = p2;
  bag.set(p0.n % 5, p2);
  if (p2.n % 53 === 1) keptFunctions.push(g27);
  holder.hold(p2);
  if (p1.n % 89 === 22) throw p2;
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r28 = h1({ tag: "s22." + o1.n, n: o1.n + 1, a: o2, b: null }, o2, (v) => {
      o1.a = o2;
      if (o2 === v) o2.n += 1000;
      return v;
    }, 1);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 31 === 22) kept.push(r28);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r29 = h1(o2, { tag: "s24." + o2.n, n: o2.n + 2, a: o1, b: null }, (v) => {
      v.a = v;
      o2.a = o0;
      if (o1 === o1) o1.n += 1000;
      return null;
    }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 89 === 3) kept.push(r29);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r30 = h4(o0, { tag: "s26." + o0.n, n: o0.n + 1, a: o0, b: null }, (v) => {
      if (v.n % 41 === 29) kept.push(o1);
      o0.b = o1;
      return v;
    }, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 61 === 11) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h6(o0, { tag: "s28." + o1.n, n: o1.n + 1, a: o1, b: null }, o0, (v) => {
      if (o1.n % 89 === 28) kept.push(o0);
      v.a = null;
      return { tag: "s29." + v.n, n: v.n + 2, a: v, b: null };
    }, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 89 === 17) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h2(o0, o0, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 53 === 18) kept.push(r32);
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
