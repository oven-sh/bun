// Made by test/aot/generate-relations-at-random.ts, seed 5: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const t0 = holder.take();
  const r1 = h4(p0, d);
  const t2 = slot;
  const g3 = (v) => {
    if (p0.n % 89 === 15) slot = v;
    v.b = p2;
    return null;
  };
  const t4 = slot;
  const r5 = f0(p1);
  try {
    if (p0.n % 41 === 19) slot = p1;
    if (p2.n % 31 === 2) throw p0;
  } finally {
    p2.b = p1;
  }
  return t2;
}
function h1(p0, p1, f0, d) {
  const g6 = first.bind(null, p1);
  const o7 = { tag: "s2." + p1.n, n: p1.n + 2, a: p0, b: null };
  const r8 = h2(o7, p1, d);
  const g9 = first.bind(null, p0);
  holder.hold(p0);
  if (p0.n % 31 === 12) kept.push(p1);
  holder.hold(o7);
  if (o7.n % 71 === 6) keptFunctions.push(g6);
  return null;
}
function h2(p0, p1, d) {
  const c10 = p0.n % 2 === 0 ? p0 : p1;
  const { a: t11 } = p1;
  const g12 = first.bind(null, p1);
  return p0;
}
function h3(p0, p1, d) {
  const r13 = h6.apply(null, [{ tag: "s5." + p1.n, n: p1.n + 9, a: p1, b: null }, d]);
  const g14 = (v) => {
    if (p0.n % 31 === 19) slot = p0;
    p1.b = p0;
    if (v === p1) v.n += 1000;
    return p1;
  };
  const w15 = new Made("c7." + p0.n, p0.n + 6, p0);
  w15.a.a = p0;
  if (p0.n % 37 === 13) throw p1;
  return null;
}
function h4(p0, d) {
  const r16 = h5(p0, p0, { tag: "s9." + p0.n, n: p0.n + 1, a: null, b: null }, d);
  if (p0.n % 37 === 5) holder.hold(p0);
  return p0;
}
function h5(p0, p1, p2, d) {
  const r17 = h6(p0, d);
  p0.a = null;
  if (p1 === p0) p1.n += 1000;
  if (p2.n % 31 === 8) throw p0;
  const t18 = bag.get(p2.n % 5) ?? null;
  return p0;
}
function h6(p0, d) {
  const c19 = p0.n % 2 === 0 ? p0 : p0;
  c19.a = p0;
  const t20 = bag.get(c19.n % 5) ?? null;
  holder.hold(p0);
  if (t20 !== null) {
    t20.n += 1;
  }
  const t21 = holder.take();
  return t21;
}
function h7(p0, d) {
  let r22 = null;
  try {
    r22 = h8(p0, d);
  } catch (e) {
    r22 = e;
  }
  const r23 = d > 0 ? h7({ tag: "s13." + p0.n, n: p0.n + 5, a: p0, b: null }, d - 1) : null;
  const r24 = h8.apply(null, [p0, d]);
  const t25 = bag.get(p0.n % 5) ?? null;
  const o26 = { tag: "s14." + p0.n, n: p0.n + 8, a: p0, b: null };
  return o26;
}
function h8(p0, d) {
  if (p0.n % 61 === 10) throw p0;
  const l27 = [p0, p0];
  l27[1].b = p0;
  const t28 = p0.a;
  const g29 = first.bind(null, p0);
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h2(o0, o1, 2);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 71 === 23) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h4(o1, 1);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 71 === 27) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h8(o0, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 31 === 24) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h8(o1, 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 41 === 16) kept.push(r33);
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
