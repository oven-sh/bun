// Made by test/aot/generate-relations-at-random.ts, seed 51: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const t0 = bag.get(p0.n % 5) ?? null;
  const t1 = bag.get(p0.n % 5) ?? null;
  let r2 = null;
  try {
    r2 = h1(p0, (v) => {
      if (v.n % 89 === 23) kept.push(p0);
      p0.n += 3;
      return v;
    }, d);
  } catch (e) {
    r2 = e;
  }
  return { tag: "s1." + p0.n, n: p0.n + 4, a: p0, b: null };
}
function h1(p0, f0, d) {
  const r3 = h5(p0, { tag: "s2." + p0.n, n: p0.n + 6, a: p0, b: null }, p0, d);
  const c4 = p0.n % 2 === 0 ? p0 : p0;
  const t5 = slot;
  const { a: t6 } = p0;
  const r7 = h3(p0, d);
  const r8 = h3(c4, d);
  return null;
}
function h2(p0, d) {
  for (const v of both(p0, p0)) {
    p0.b = null;
  }
  const t9 = p0.b;
  const o10 = { tag: "s4." + p0.n, n: p0.n + 7, a: null, b: null };
  return t9;
}
function h3(p0, d) {
  if (p0.n % 31 === 29) throw p0;
  const t11 = holder.take();
  if (p0 === p0) p0.n += 1000;
  p0.n += 5;
  const r12 = h4.call(null, p0, p0, p0, (v) => {
    if (v.n % 31 === 21) slot = p0;
    v.b = p0;
    return p0;
  }, d);
  return t11;
}
function h4(p0, p1, p2, f0, d) {
  const r13 = h5(p0, p2, p0, d);
  const t14 = holder.take();
  const t15 = holder.take();
  const t16 = p1.b;
  return p2;
}
function h5(p0, p1, p2, d) {
  const t17 = bag.get(p1.n % 5) ?? null;
  try {
    p0.a = p2;
    if (p2.n % 31 === 7) throw p1;
  } finally {
    p0.n += 2;
  }
  const o18 = new Made("c9." + p2.n, p2.n + 5, p0);
  const g19 = (v) => {
    if (p2.n % 41 === 25) kept.push(o18);
    return o18;
  };
  const { b: t20 } = o18;
  const l21 = [o18, p2];
  l21[0].a = p1;
  const t22 = bag.get(p2.n % 5) ?? null;
  const c23 = p2.n % 2 === 0 ? p2 : p2;
  return c23;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r24 = h2(o0, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 37 === 24) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h3({ tag: "s12." + o0.n, n: o0.n + 7, a: o0, b: null }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 37 === 8) kept.push(r25);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r26 = h0(o1, 1);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 37 === 4) kept.push(r26);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r27 = h2({ tag: "s13." + o0.n, n: o0.n + 9, a: o0, b: null }, 0);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 89 === 17) kept.push(r27);
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
