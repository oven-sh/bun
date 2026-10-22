// Made by test/aot/generate-relations-at-random.ts, seed 23: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  holder.hold(p0);
  try {
    p0.a = p0;
    if (p0.n % 71 === 4) throw p0;
  } finally {
    p0.n += 5;
  }
  const r0 = h4.call(null, p0, d);
  const r1 = h5.apply(null, [p0, (v) => {
    if (v.n % 71 === 4) kept.push(p0);
    return p0;
  }, d]);
  if (p0.n % 41 === 1) throw p0;
  const c2 = p0.n % 2 === 0 ? p0 : p0;
  const g3 = first.bind(null, p0);
  const r4 = h4(p0, d);
  return r4;
}
function h1(p0, f0, d) {
  const c5 = p0.n % 2 === 0 ? p0 : p0;
  const r6 = f0(p0);
  const t7 = c5.a;
  return { tag: "s2." + p0.n, n: p0.n + 7, a: null, b: null };
}
function h2(p0, d) {
  if (p0 === p0) p0.n += 1000;
  holder.hold(p0);
  const o8 = { tag: "s3." + p0.n, n: p0.n + 2, a: p0, b: null };
  p0.a = null;
  const o9 = { tag: "s4." + p0.n, n: p0.n + 6, a: o8, b: null };
  return o9;
}
function h3(p0, p1, p2, d) {
  bag.set(p1.n % 5, p0);
  const t10 = holder.take();
  const r11 = h5(p2, (v) => {
    if (v === p0) v.n += 1000;
    v.a = null;
    if (p2.n % 71 === 9) slot = p0;
    return { tag: "s6." + v.n, n: v.n + 7, a: p2, b: null };
  }, d);
  return r11;
}
function h4(p0, d) {
  const t12 = bag.get(p0.n % 5) ?? null;
  const r13 = d > 0 ? h4(p0, d - 1) : null;
  const g14 = first.bind(null, p0);
  const r15 = g14(p0);
  const l16 = [p0, p0];
  l16[0].a = p0;
  const w17 = { tag: "s8." + p0.n, n: p0.n + 8, a: p0, b: null };
  w17.a.a = p0;
  if (p0.n % 89 === 5) kept.push(p0);
  const g18 = first.bind(null, p0);
  return t12;
}
function h5(p0, f0, d) {
  const { b: t19 } = p0;
  const t20 = holder.take();
  p0.n += 3;
  if (p0.n % 61 === 16) keptFunctions.push(f0);
  return t19;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h3(o2, o0, o1, 0);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 31 === 9) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h2(o0, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 31 === 29) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h4(o2, 0);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 31 === 15) kept.push(r23);
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
