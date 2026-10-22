// Made by test/aot/generate-relations-at-random.ts, seed 75: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = d > 0 ? h0(p0, d - 1) : null;
  const g1 = (v) => {
    p0.b = p0;
    return v;
  };
  p0.n += 5;
  if (p0.n % 61 === 14) throw p0;
  for (const v of both(p0, p0)) {
    if (p0.n % 53 === 12) slot = p0;
  }
  return { tag: "s1." + p0.n, n: p0.n + 3, a: p0, b: null };
}
function h1(p0, f0, d) {
  const l2 = [p0, p0];
  l2[1].b = p0;
  const t3 = bag.get(p0.n % 5) ?? null;
  const r4 = f0(p0);
  for (const v of both(p0, p0)) {
    p0.b = null;
  }
  if (p0.n % 61 === 5) keptFunctions.push(f0);
  const t5 = holder.take();
  for (const v of both(p0, p0)) {
    v.a = null;
  }
  return null;
}
function h2(p0, p1, d) {
  const o6 = { tag: "s3." + p1.n, n: p1.n + 7, a: p1, b: null };
  if (p0.n % 61 === 6) throw p0;
  if (p0.n % 41 === 10) slot = o6;
  return p0;
}
function h3(p0, p1, p2, f0, d) {
  if (p0.n % 89 === 4) throw p2;
  const r7 = h4(p1, f0, d);
  const t8 = bag.get(p1.n % 5) ?? null;
  return p0;
}
function h4(p0, f0, d) {
  const r9 = h5(p0, p0, d);
  const t10 = p0.b;
  const o11 = { tag: "s6." + p0.n, n: p0.n + 1, a: p0, b: null };
  return { tag: "s7." + p0.n, n: p0.n + 4, a: null, b: null };
}
function h5(p0, p1, d) {
  let r12 = null;
  try {
    r12 = h6(p1, p0, p0, d);
  } catch (e) {
    r12 = e;
  }
  if (p1.n % 89 === 9) throw p0;
  return p0;
}
function h6(p0, p1, p2, d) {
  for (const v of both(p0, p1)) {
    if (v.n % 37 === 23) slot = p1;
  }
  try {
    p1.n += 5;
    if (p0.n % 61 === 27) throw p1;
  } finally {
    p2.a = null;
  }
  p0.a = p2;
  if (p1.n % 37 === 6) throw p2;
  const c13 = p2.n % 2 === 0 ? p2 : p2;
  return p2;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r14 = h6(o1, o1, o2, 1);
    if (r14 !== null) {
      sum += r14.n;
      if (r14.n % 89 === 13) kept.push(r14);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r15 = h6({ tag: "s10." + o2.n, n: o2.n + 8, a: null, b: null }, o2, o2, 2);
    if (r15 !== null) {
      sum += r15.n;
      if (r15.n % 37 === 24) kept.push(r15);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r16 = h5(o2, o1, 0);
    if (r16 !== null) {
      sum += r16.n;
      if (r16.n % 37 === 3) kept.push(r16);
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
