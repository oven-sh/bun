// Made by test/aot/generate-relations-at-random.ts, seed 39: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, p1, p2, d) {
  const o0 = { tag: "s0." + p1.n, n: p1.n + 9, a: null, b: null };
  const g1 = first.bind(null, p1);
  for (const v of both(p2, p0)) {
    p2.n += 1;
  }
  const w2 = { tag: "s1." + p2.n, n: p2.n + 3, a: p2, b: null };
  w2.a.a = p0;
  for (const v of both(p0, p1)) {
    o0.a = p0;
  }
  return p1;
}
function h1(p0, d) {
  try {
    p0.n += 1;
    if (p0.n % 61 === 20) throw p0;
  } finally {
    if (p0.n % 53 === 17) slot = p0;
  }
  if (p0 === p0) p0.n += 1000;
  const t3 = bag.get(p0.n % 5) ?? null;
  const l4 = [p0, p0];
  l4[0].a = p0;
  const l5 = [p0, p0];
  l5[0].a = p0;
  const c6 = p0.n % 2 === 0 ? p0 : p0;
  return { tag: "s3." + p0.n, n: p0.n + 9, a: null, b: null };
}
function h2(p0, p1, f0, d) {
  const o7 = { tag: "s4." + p0.n, n: p0.n + 1, a: p0, b: null };
  if (o7.n % 31 === 18) keptFunctions.push(f0);
  const w8 = new Made("c5." + p1.n, p1.n + 7, o7);
  w8.a.a = p1;
  if (p1.n % 61 === 21) keptFunctions.push(f0);
  return p0;
}
function h3(p0, d) {
  const t9 = p0.b;
  const { b: t10 } = p0;
  const g11 = first.bind(null, p0);
  if (t9 !== null) {
    p0.n += 3;
  }
  if (p0.n % 31 === 27) kept.push(p0);
  const t12 = holder.take();
  const g13 = (v) => {
    if (v.n % 41 === 3) slot = v;
    v.b = v;
    return v;
  };
  const t14 = bag.get(p0.n % 5) ?? null;
  return { tag: "s8." + p0.n, n: p0.n + 3, a: p0, b: null };
}
function h4(p0, p1, p2, d) {
  if (p2 === p0) p2.n += 1000;
  const r15 = d > 0 ? h4(p2, { tag: "s9." + p0.n, n: p0.n + 1, a: p0, b: null }, p1, d - 1) : null;
  const r16 = h5(p2, { tag: "s10." + p2.n, n: p2.n + 9, a: p0, b: null }, p1, d);
  const l17 = [p2, p2];
  l17[0].a = p2;
  const c18 = p0.n % 2 === 0 ? p0 : p1;
  try {
    p1.a = p1;
    if (p0.n % 41 === 5) throw p2;
  } finally {
    c18.b = c18;
  }
  return p2;
}
function h5(p0, p1, p2, d) {
  const c19 = p2.n % 2 === 0 ? p2 : p2;
  const t20 = slot;
  const r21 = d > 0 ? h5(p2, { tag: "s12." + c19.n, n: c19.n + 1, a: p0, b: null }, new Made("c13." + c19.n, c19.n + 5, p2), d - 1) : null;
  bag.set(p1.n % 5, p2);
  if (t20 !== null) {
    if (p0.n % 53 === 17) slot = p1;
  }
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r22 = h5(o1, o1, { tag: "s15." + o1.n, n: o1.n + 7, a: o2, b: null }, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 37 === 7) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h2(o0, o1, (v) => {
      o2.n += 1;
      return o1;
    }, 0);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 37 === 2) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h3(o2, 2);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 61 === 20) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h1(o0, 1);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 71 === 10) kept.push(r25);
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
