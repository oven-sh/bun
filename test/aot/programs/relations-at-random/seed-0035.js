// Made by test/aot/generate-relations-at-random.ts, seed 35: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  holder.hold(p1);
  const { b: t0 } = p1;
  const r1 = h4(new Made("c0." + p1.n, p1.n + 2, p0), d);
  return r1;
}
function h1(p0, p1, p2, f0, d) {
  const t2 = slot;
  p0.n += 2;
  const r3 = h5({ tag: "s2." + p0.n, n: p0.n + 7, a: p0, b: null }, { tag: "s3." + p0.n, n: p0.n + 9, a: p0, b: null }, { tag: "s4." + p2.n, n: p2.n + 8, a: null, b: null }, d);
  const t4 = p0.a;
  const g5 = (v) => {
    if (p1 === p2) p1.n += 1000;
    p2.a = null;
    return v;
  };
  let r6 = null;
  try {
    r6 = h5(p2, p2, { tag: "s6." + p1.n, n: p1.n + 1, a: p1, b: null }, d);
  } catch (e) {
    r6 = e;
  }
  return p2;
}
function h2(p0, f0, d) {
  const t7 = slot;
  const g8 = first.bind(null, p0);
  if (t7 !== null) {
    if (p0.n % 61 === 2) kept.push(p0);
  }
  const r9 = d > 0 ? h2({ tag: "s8." + p0.n, n: p0.n + 7, a: null, b: null }, g8, d - 1) : null;
  const w10 = { tag: "s9." + p0.n, n: p0.n + 9, a: p0, b: null };
  w10.a.a = p0;
  const t11 = bag.get(p0.n % 5) ?? null;
  for (const v of both(p0, p0)) {
    if (v.n % 61 === 16) slot = p0;
  }
  const r12 = h3(p0, p0, p0, d);
  return { tag: "s10." + p0.n, n: p0.n + 4, a: null, b: null };
}
function h3(p0, p1, p2, d) {
  const t13 = holder.take();
  const t14 = bag.get(p1.n % 5) ?? null;
  for (const v of both(p0, p0)) {
    p0.n += 1;
  }
  return t13;
}
function h4(p0, d) {
  holder.hold(p0);
  bag.set(p0.n % 5, p0);
  const t15 = p0.b;
  const r16 = h5({ tag: "s12." + p0.n, n: p0.n + 4, a: null, b: null }, p0, p0, d);
  return t15;
}
function h5(p0, p1, p2, d) {
  const o17 = { tag: "s14." + p0.n, n: p0.n + 8, a: p1, b: null };
  const g18 = (v) => {
    if (v === p1) v.n += 1000;
    return p1;
  };
  const o19 = { tag: "s16." + p2.n, n: p2.n + 4, a: o17, b: null };
  const t20 = slot;
  const t21 = o19.a;
  return o19;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r22 = h2(o2, (v) => {
      o0.b = null;
      o1.a = o0;
      return null;
    }, 1);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 24) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h3(o2, o2, o0, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 31 === 4) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h3(o1, o1, o0, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 31 === 3) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h4(o1, 1);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 41 === 16) kept.push(r25);
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
