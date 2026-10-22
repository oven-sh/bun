// Made by test/aot/generate-relations-at-random.ts, seed 53: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, p2, f0, d) {
  const r0 = h5({ tag: "s0." + p1.n, n: p1.n + 8, a: p1, b: null }, p0, p1, d);
  const c1 = p0.n % 2 === 0 ? p0 : p0;
  bag.set(p0.n % 5, p0);
  const t2 = bag.get(p1.n % 5) ?? null;
  const g3 = first.bind(null, p0);
  const r4 = d > 0 ? h0(c1, { tag: "s1." + c1.n, n: c1.n + 8, a: p2, b: null }, { tag: "s2." + c1.n, n: c1.n + 8, a: null, b: null }, g3, d - 1) : null;
  const w5 = new Made("c3." + c1.n, c1.n + 6, p2);
  w5.a.a = c1;
  return r0;
}
function h1(p0, p1, p2, f0, d) {
  const r6 = d > 0 ? h1(p0, p0, { tag: "s5." + p2.n, n: p2.n + 3, a: p1, b: null }, (v) => {
    if (p1.n % 89 === 26) slot = p0;
    p0.n += 4;
    p0.b = p0;
    return p1;
  }, d - 1) : null;
  const t7 = slot;
  const g8 = first.bind(null, p0);
  if (p1.n % 41 === 17) throw p1;
  const t9 = slot;
  if (p1.n % 53 === 7) throw p1;
  const g10 = (v) => {
    if (p0.n % 41 === 0) kept.push(v);
    return null;
  };
  return p0;
}
function h2(p0, p1, f0, d) {
  const r11 = d > 0 ? h2(p0, p0, f0, d - 1) : null;
  const t12 = bag.get(p0.n % 5) ?? null;
  try {
    if (p1.n % 89 === 9) slot = p0;
    if (p0.n % 37 === 27) throw p1;
  } finally {
    p1.n += 1;
  }
  try {
    if (p1.n % 37 === 3) kept.push(p0);
    if (p1.n % 89 === 29) throw p0;
  } finally {
    p0.b = p0;
  }
  return { tag: "s9." + p0.n, n: p0.n + 7, a: p1, b: null };
}
function h3(p0, p1, p2, d) {
  const r13 = d > 0 ? h3(p2, { tag: "s10." + p0.n, n: p0.n + 8, a: p0, b: null }, p0, d - 1) : null;
  p1.a = p0;
  const t14 = bag.get(p0.n % 5) ?? null;
  if (r13 !== null) {
    if (p0.n % 71 === 9) slot = p2;
  }
  if (r13 !== null) {
    if (p0.n % 71 === 24) kept.push(p2);
  }
  return p1;
}
function h4(p0, p1, p2, d) {
  const t15 = slot;
  if (p2.n % 89 === 7) throw p0;
  let c16 = p0;
  for (let k = 0; k < 3; k++) c16 = c16.b ?? p1;
  return t15;
}
function h5(p0, p1, p2, d) {
  const t17 = holder.take();
  return p2;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r18 = h5({ tag: "s14." + o0.n, n: o0.n + 1, a: o2, b: null }, o0, o2, 1);
    if (r18 !== null) {
      sum += r18.n;
      if (r18.n % 41 === 0) kept.push(r18);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r19 = h3(o0, o1, o2, 1);
    if (r19 !== null) {
      sum += r19.n;
      if (r19.n % 41 === 15) kept.push(r19);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r20 = h5({ tag: "s15." + o0.n, n: o0.n + 3, a: null, b: null }, o1, { tag: "s16." + o2.n, n: o2.n + 9, a: o1, b: null }, 2);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 37 === 9) kept.push(r20);
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
