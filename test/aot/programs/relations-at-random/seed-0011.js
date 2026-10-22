// Made by test/aot/generate-relations-at-random.ts, seed 11: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0 === p1) p0.n += 1000;
  const t0 = holder.take();
  const c1 = p1.n % 2 === 0 ? p1 : p0;
  if (p0.n % 41 === 4) holder.hold(p0);
  return { tag: "s0." + c1.n, n: c1.n + 6, a: p1, b: null };
}
function h1(p0, p1, d) {
  let r2 = null;
  try {
    r2 = h2({ tag: "s1." + p1.n, n: p1.n + 3, a: p1, b: null }, p1, (v) => {
      p1.n += 4;
      return v;
    }, d);
  } catch (e) {
    r2 = e;
  }
  let r3 = null;
  try {
    r3 = h6(p1, p1, { tag: "s3." + p0.n, n: p0.n + 2, a: p1, b: null }, d);
  } catch (e) {
    r3 = e;
  }
  const g4 = first.bind(null, p0);
  return r3;
}
function h2(p0, p1, f0, d) {
  const t5 = p0.a;
  const o6 = { tag: "s5." + p0.n, n: p0.n + 5, a: null, b: null };
  const c7 = p0.n % 2 === 0 ? p0 : p1;
  o6.n += 1;
  try {
    o6.b = p0;
    if (o6.n % 89 === 10) throw o6;
  } finally {
    if (c7.n % 61 === 2) slot = p1;
  }
  return p1;
}
function h3(p0, p1, d) {
  if (p0.n % 89 === 22) slot = p0;
  const t8 = bag.get(p0.n % 5) ?? null;
  const c9 = p1.n % 2 === 0 ? p1 : p1;
  const w10 = new Made("c7." + p0.n, p0.n + 8, p1);
  w10.a.a = p0;
  for (const v of both(c9, p1)) {
    v.a = null;
  }
  let r11 = null;
  try {
    r11 = h5(p0, { tag: "s8." + p1.n, n: p1.n + 7, a: p1, b: null }, p1, d);
  } catch (e) {
    r11 = e;
  }
  try {
    p0.b = p1;
    if (p1.n % 41 === 16) throw p1;
  } finally {
    p1.a = p0;
  }
  return r11;
}
function h4(p0, p1, d) {
  const o12 = { tag: "s10." + p1.n, n: p1.n + 2, a: p0, b: null };
  const o13 = { tag: "s11." + p0.n, n: p0.n + 7, a: null, b: null };
  for (const v of both(o12, o13)) {
    p1.a = o13;
  }
  const t14 = p0.b;
  const t15 = bag.get(o13.n % 5) ?? null;
  holder.hold(p0);
  const t16 = bag.get(o13.n % 5) ?? null;
  return t14;
}
function h5(p0, p1, p2, d) {
  const o17 = { tag: "s13." + p0.n, n: p0.n + 5, a: p0, b: null };
  const g18 = first.bind(null, p2);
  const g19 = (v) => {
    p2.a = p1;
    return o17;
  };
  p2.n += 5;
  let r20 = null;
  try {
    r20 = h6(new Made("c15." + p2.n, p2.n + 7, p0), { tag: "s16." + p0.n, n: p0.n + 6, a: p2, b: null }, p2, d);
  } catch (e) {
    r20 = e;
  }
  return r20;
}
function h6(p0, p1, p2, d) {
  let c21 = p0;
  for (let k = 0; k < 3; k++) c21 = c21.a ?? p1;
  const r22 = h7(p2, (v) => {
    c21.n += 2;
    if (p1 === c21) p1.n += 1000;
    return c21;
  }, d);
  const g23 = first.bind(null, c21);
  return p0;
}
function h7(p0, f0, d) {
  const g24 = (v) => {
    if (v === v) v.n += 1000;
    return null;
  };
  const l25 = [p0, p0];
  l25[1].b = p0;
  const g26 = (v) => {
    v.b = p0;
    return p0;
  };
  if (p0.n % 61 === 0) throw p0;
  const t27 = holder.take();
  const g28 = first.bind(null, p0);
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r29 = h1(new Made("c23." + o2.n, o2.n + 4, o2), { tag: "s24." + o0.n, n: o0.n + 1, a: null, b: null }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 31 === 0) kept.push(r29);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r30 = h3(new Made("c25." + o2.n, o2.n + 4, null), { tag: "s26." + o0.n, n: o0.n + 7, a: o0, b: null }, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 11) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h6(o1, o1, o2, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 53 === 12) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h3(o1, { tag: "s27." + o1.n, n: o1.n + 2, a: o0, b: null }, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 71 === 21) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h1(o1, new Made("c28." + o0.n, o0.n + 5, null), 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 71 === 26) kept.push(r33);
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
