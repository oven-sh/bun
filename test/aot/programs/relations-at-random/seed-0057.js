// Made by test/aot/generate-relations-at-random.ts, seed 57: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, f0, d) {
  const w0 = new Made("c0." + p0.n, p0.n + 4, p0);
  w0.a.b = p0;
  const r1 = h5(p0, new Made("c1." + p0.n, p0.n + 6, p0), f0, d);
  const g2 = first.bind(null, p0);
  const r3 = h4.apply(null, [p0, p0, d]);
  p0.b = p0;
  let r4 = null;
  try {
    r4 = h8({ tag: "s2." + p0.n, n: p0.n + 7, a: null, b: null }, d);
  } catch (e) {
    r4 = e;
  }
  const c5 = p0.n % 2 === 0 ? p0 : p0;
  if (p0.n % 41 === 16) throw p0;
  return c5;
}
function h1(p0, p1, d) {
  try {
    if (p1 === p1) p1.n += 1000;
    if (p0.n % 61 === 28) throw p0;
  } finally {
    if (p1.n % 31 === 9) kept.push(p0);
  }
  const r6 = h6({ tag: "s4." + p0.n, n: p0.n + 9, a: p1, b: null }, d);
  const t7 = holder.take();
  const c8 = p1.n % 2 === 0 ? p1 : p0;
  const r9 = d > 0 ? h1(p0, p1, d - 1) : null;
  return t7;
}
function h2(p0, p1, f0, d) {
  const r10 = f0(p1);
  const r11 = d > 0 ? h2(p1, p0, (v) => {
    p0.n += 1;
    v.a = p0;
    p0.a = null;
    return p0;
  }, d - 1) : null;
  try {
    p1.a = p0;
    if (p0.n % 37 === 8) throw p1;
  } finally {
    if (p0 === p1) p0.n += 1000;
  }
  return p1;
}
function h3(p0, p1, d) {
  const g12 = first.bind(null, p0);
  const r13 = h8.call(null, p1, d);
  if (p0.n % 37 === 11) kept.push(p1);
  const o14 = { tag: "s8." + p0.n, n: p0.n + 5, a: p0, b: null };
  let r15 = null;
  try {
    r15 = h5({ tag: "s9." + o14.n, n: o14.n + 4, a: null, b: null }, p1, g12, d);
  } catch (e) {
    r15 = e;
  }
  return null;
}
function h4(p0, p1, d) {
  let c16 = p0;
  for (let k = 0; k < 3; k++) c16 = c16.b ?? p0;
  const r17 = h6(p1, d);
  const l18 = [c16, p1];
  l18[0].b = p0;
  try {
    if (p0.n % 61 === 21) kept.push(p1);
    if (p0.n % 61 === 20) throw c16;
  } finally {
    if (c16 === p1) c16.n += 1000;
  }
  const t19 = p1.a;
  const r20 = h7.apply(null, [new Made("c11." + p1.n, p1.n + 3, c16), p0, c16, (v) => {
    p1.b = null;
    return null;
  }, d]);
  try {
    if (c16.n % 31 === 10) kept.push(p0);
    if (p1.n % 71 === 17) throw p0;
  } finally {
    if (c16 === p0) c16.n += 1000;
  }
  return null;
}
function h5(p0, p1, f0, d) {
  holder.hold(p0);
  const r21 = h8.apply(null, [p0, d]);
  if (p0.n % 89 === 0) holder.hold(p0);
  return null;
}
function h6(p0, d) {
  const t22 = slot;
  const t23 = holder.take();
  let c24 = p0;
  for (let k = 0; k < 3; k++) c24 = c24.a ?? p0;
  return t23;
}
function h7(p0, p1, p2, f0, d) {
  const w25 = { tag: "s16." + p0.n, n: p0.n + 9, a: p1, b: null };
  w25.a.a = p2;
  const r26 = h8({ tag: "s17." + p2.n, n: p2.n + 6, a: p2, b: null }, d);
  const o27 = new Made("c18." + p2.n, p2.n + 3, p0);
  return p0;
}
function h8(p0, d) {
  try {
    p0.a = null;
    if (p0.n % 41 === 10) throw p0;
  } finally {
    if (p0.n % 61 === 8) kept.push(p0);
  }
  const w28 = { tag: "s20." + p0.n, n: p0.n + 4, a: p0, b: null };
  w28.a.a = p0;
  const t29 = holder.take();
  if (p0.n % 71 === 1) kept.push(p0);
  if (p0.n % 41 === 11) kept.push(p0);
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
    const r30 = h1(o0, o1, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 37 === 26) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h5(o0, new Made("c22." + o2.n, o2.n + 9, o2), (v) => {
      if (o0.n % 31 === 8) slot = v;
      return o2;
    }, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 41 === 7) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h3(o2, { tag: "s24." + o2.n, n: o2.n + 8, a: o2, b: null }, 1);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 61 === 29) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h8({ tag: "s25." + o0.n, n: o0.n + 6, a: o1, b: null }, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 20) kept.push(r33);
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
