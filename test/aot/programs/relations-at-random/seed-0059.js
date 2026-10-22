// Made by test/aot/generate-relations-at-random.ts, seed 59: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  let c0 = p0;
  for (let k = 0; k < 3; k++) c0 = c0.a ?? p1;
  for (const v of both(p0, p1)) {
    p1.b = null;
  }
  holder.hold(c0);
  return { tag: "s0." + p0.n, n: p0.n + 2, a: p0, b: null };
}
function h1(p0, f0, d) {
  if (p0.n % 89 === 22) throw p0;
  p0.a = p0;
  bag.set(p0.n % 5, p0);
  if (p0.n % 41 === 26) slot = p0;
  const t1 = slot;
  const r2 = d > 0 ? h1(p0, (v) => {
    v.a = v;
    if (v.n % 37 === 14) kept.push(p0);
    return v;
  }, d - 1) : null;
  const r3 = h2({ tag: "s2." + p0.n, n: p0.n + 6, a: null, b: null }, { tag: "s3." + p0.n, n: p0.n + 6, a: null, b: null }, (v) => {
    p0.b = null;
    return p0;
  }, d);
  return r2;
}
function h2(p0, p1, f0, d) {
  const r4 = f0(p1);
  const t5 = bag.get(p0.n % 5) ?? null;
  if (p1.n % 61 === 17) keptFunctions.push(f0);
  const t6 = p1.a;
  const r7 = d > 0 ? h2({ tag: "s6." + p0.n, n: p0.n + 4, a: p0, b: null }, p0, (v) => {
    if (p0.n % 53 === 23) kept.push(v);
    return null;
  }, d - 1) : null;
  const w8 = new Made("c8." + p1.n, p1.n + 7, p1);
  w8.a.b = p1;
  return new Made("c9." + p1.n, p1.n + 1, p1);
}
function h3(p0, d) {
  const t9 = slot;
  if (t9 !== null) {
    if (t9 === p0) t9.n += 1000;
  }
  const t10 = slot;
  return t10;
}
function h4(p0, f0, d) {
  const r11 = f0(p0);
  const t12 = slot;
  const o13 = { tag: "s11." + p0.n, n: p0.n + 8, a: null, b: null };
  const t14 = bag.get(o13.n % 5) ?? null;
  if (p0.n % 71 === 13) keptFunctions.push(f0);
  return { tag: "s12." + p0.n, n: p0.n + 5, a: null, b: null };
}
function h5(p0, p1, p2, f0, d) {
  const t15 = slot;
  if (p2.n % 31 === 16) keptFunctions.push(f0);
  const t16 = slot;
  if (t16 !== null) {
    p1.b = p0;
  }
  const t17 = p1.a;
  const g18 = (v) => {
    v.a = p0;
    return v;
  };
  return p1;
}
function h6(p0, p1, d) {
  if (p1.n % 53 === 0) kept.push(p1);
  const l19 = [p1, p1];
  l19[1].a = p0;
  const g20 = first.bind(null, p1);
  let c21 = p1;
  for (let k = 0; k < 3; k++) c21 = c21.a ?? p1;
  if (p1.n % 53 === 5) throw p0;
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r22 = h1(new Made("c16." + o0.n, o0.n + 9, o2), (v) => {
      if (o0 === o1) o0.n += 1000;
      if (v.n % 61 === 16) kept.push(v);
      return v;
    }, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 41 === 10) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h2(o1, o0, (v) => {
      if (o2 === v) o2.n += 1000;
      return v;
    }, 0);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 41 === 3) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h4(o2, (v) => {
      o1.n += 5;
      o2.a = v;
      o2.b = null;
      return { tag: "s19." + v.n, n: v.n + 8, a: o1, b: null };
    }, 2);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 53 === 12) kept.push(r24);
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
