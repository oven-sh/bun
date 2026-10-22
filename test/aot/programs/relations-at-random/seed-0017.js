// Made by test/aot/generate-relations-at-random.ts, seed 17: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  p0.b = p0;
  const c0 = p0.n % 2 === 0 ? p0 : p0;
  const r1 = d > 0 ? h0(p0, d - 1) : null;
  const o2 = new Made("c0." + c0.n, c0.n + 4, null);
  holder.hold(o2);
  if (o2.n % 37 === 6) throw o2;
  for (const v of both(o2, c0)) {
    p0.b = null;
  }
  return c0;
}
function h1(p0, f0, d) {
  if (p0.n % 71 === 19) throw p0;
  bag.set(p0.n % 5, p0);
  return { tag: "s2." + p0.n, n: p0.n + 1, a: null, b: null };
}
function h2(p0, p1, p2, f0, d) {
  const t3 = slot;
  const r4 = h5(p0, (v) => {
    if (p1.n % 41 === 16) kept.push(v);
    if (p1 === p0) p1.n += 1000;
    v.n += 3;
    return p2;
  }, d);
  if (p1.n % 41 === 11) slot = p0;
  return r4;
}
function h3(p0, p1, f0, d) {
  const r5 = d > 0 ? h3({ tag: "s5." + p1.n, n: p1.n + 2, a: p1, b: null }, new Made("c6." + p1.n, p1.n + 8, null), (v) => {
    p0.a = v;
    p1.n += 1;
    return v;
  }, d - 1) : null;
  if (p0.n % 31 === 14) throw p0;
  const r6 = h6(p0, d);
  return p0;
}
function h4(p0, p1, p2, d) {
  const o7 = { tag: "s9." + p0.n, n: p0.n + 3, a: p2, b: null };
  const o8 = new Made("c10." + p0.n, p0.n + 3, p0);
  try {
    if (p2.n % 31 === 23) kept.push(p0);
    if (p0.n % 89 === 3) throw p1;
  } finally {
    p0.n += 3;
  }
  const r9 = h5(p1, (v) => {
    if (p1.n % 71 === 15) kept.push(o8);
    o8.a = p1;
    if (p2 === p0) p2.n += 1000;
    return o8;
  }, d);
  let r10 = null;
  try {
    r10 = h8({ tag: "s12." + o7.n, n: o7.n + 3, a: p0, b: null }, p1, d);
  } catch (e) {
    r10 = e;
  }
  return o8;
}
function h5(p0, f0, d) {
  const t11 = p0.b;
  const g12 = (v) => {
    v.b = v;
    v.a = null;
    return v;
  };
  const l13 = [p0, p0];
  l13[0].b = p0;
  const r14 = h6(p0, d);
  const t15 = holder.take();
  const r16 = h8({ tag: "s15." + p0.n, n: p0.n + 5, a: p0, b: null }, p0, d);
  const t17 = slot;
  return t11;
}
function h6(p0, d) {
  const r18 = h8.apply(null, [p0, { tag: "s17." + p0.n, n: p0.n + 8, a: p0, b: null }, d]);
  const g19 = (v) => {
    if (v === v) v.n += 1000;
    v.b = v;
    return new Made("c18." + v.n, v.n + 3, null);
  };
  if (p0.n % 89 === 26) slot = p0;
  const r20 = h8(p0, p0, d);
  return r20;
}
function h7(p0, p1, p2, f0, d) {
  const r21 = h8.apply(null, [p1, p2, d]);
  const { a: t22 } = p0;
  const t23 = p2.b;
  const t24 = holder.take();
  const r25 = h8(p0, { tag: "s20." + p0.n, n: p0.n + 2, a: p1, b: null }, d);
  return p1;
}
function h8(p0, p1, d) {
  const l26 = [p1, p0];
  l26[1].b = p1;
  const t27 = bag.get(p0.n % 5) ?? null;
  const c28 = p1.n % 2 === 0 ? p1 : p1;
  const t29 = slot;
  return c28;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h1(o0, (v) => {
      if (v === o2) v.n += 1000;
      o1.b = o1;
      return o1;
    }, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 89 === 28) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h1(o1, (v) => {
      if (o0.n % 61 === 1) slot = o2;
      return o1;
    }, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 31 === 28) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h8(o0, o1, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 71 === 24) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h8(o1, o0, 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 41 === 25) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h4(o2, o2, o1, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 37 === 21) kept.push(r34);
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
