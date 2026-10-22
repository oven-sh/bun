// Made by test/aot/generate-relations-at-random.ts, seed 3: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0.n % 89 === 23) kept.push(p0);
  const r0 = h3(p0, (v) => {
    if (p0 === v) p0.n += 1000;
    return null;
  }, d);
  const w1 = { tag: "s1." + p0.n, n: p0.n + 6, a: p0, b: null };
  w1.a.b = p0;
  let c2 = p0;
  for (let k = 0; k < 3; k++) c2 = c2.b ?? p0;
  const t3 = bag.get(p0.n % 5) ?? null;
  const g4 = first.bind(null, c2);
  return new Made("c2." + c2.n, c2.n + 5, p0);
}
function h1(p0, d) {
  const w5 = { tag: "s3." + p0.n, n: p0.n + 6, a: p0, b: null };
  w5.a.a = p0;
  const c6 = p0.n % 2 === 0 ? p0 : p0;
  let c7 = p0;
  for (let k = 0; k < 3; k++) c7 = c7.b ?? p0;
  try {
    c7.b = null;
    if (c6.n % 71 === 9) throw c7;
  } finally {
    if (c6.n % 61 === 4) kept.push(c7);
  }
  return p0;
}
function h2(p0, p1, d) {
  const r8 = h3.apply(null, [p0, (v) => {
    v.a = p1;
    return v;
  }, d]);
  const r9 = d > 0 ? h2({ tag: "s6." + p1.n, n: p1.n + 7, a: null, b: null }, p1, d - 1) : null;
  const r10 = d > 0 ? h2(p0, p1, d - 1) : null;
  const t11 = p0.b;
  if (p0.n % 89 === 2) throw p0;
  const r12 = h8(p1, p0, p0, (v) => {
    p0.a = p1;
    return { tag: "s7." + v.n, n: v.n + 4, a: v, b: null };
  }, d);
  const g13 = (v) => {
    if (p0.n % 31 === 5) slot = p0;
    return null;
  };
  bag.set(p0.n % 5, p1);
  return p0;
}
function h3(p0, f0, d) {
  if (p0 === p0) p0.n += 1000;
  p0.b = null;
  p0.a = null;
  const t14 = slot;
  holder.hold(p0);
  return t14;
}
function h4(p0, p1, f0, d) {
  const r15 = d > 0 ? h4(p0, p1, (v) => {
    p1.a = p0;
    v.a = null;
    v.a = null;
    return v;
  }, d - 1) : null;
  const r16 = f0(p0);
  for (const v of both(p1, p1)) {
    p1.b = p0;
  }
  const c17 = p1.n % 2 === 0 ? p1 : p1;
  for (const v of both(p0, c17)) {
    c17.b = null;
  }
  const t18 = c17.b;
  c17.b = c17;
  return t18;
}
function h5(p0, d) {
  let r19 = null;
  try {
    r19 = h6(p0, p0, d);
  } catch (e) {
    r19 = e;
  }
  for (const v of both(p0, p0)) {
    p0.b = null;
  }
  const t20 = holder.take();
  return r19;
}
function h6(p0, p1, d) {
  const t21 = holder.take();
  let r22 = null;
  try {
    r22 = h7({ tag: "s14." + p0.n, n: p0.n + 7, a: p1, b: null }, p1, { tag: "s15." + p1.n, n: p1.n + 5, a: p0, b: null }, (v) => {
      p1.b = p1;
      if (p0.n % 31 === 8) slot = p1;
      return v;
    }, d);
  } catch (e) {
    r22 = e;
  }
  const r23 = h7(p1, { tag: "s17." + p0.n, n: p0.n + 4, a: p1, b: null }, p0, (v) => {
    p0.a = null;
    return null;
  }, d);
  const o24 = { tag: "s19." + p0.n, n: p0.n + 8, a: p0, b: null };
  return p1;
}
function h7(p0, p1, p2, f0, d) {
  const t25 = slot;
  const t26 = holder.take();
  const t27 = holder.take();
  return null;
}
function h8(p0, p1, p2, f0, d) {
  const l28 = [p1, p2];
  l28[0].a = p2;
  for (const v of both(p1, p2)) {
    p1.b = p2;
  }
  const t29 = holder.take();
  const t30 = bag.get(p0.n % 5) ?? null;
  const w31 = { tag: "s22." + p1.n, n: p1.n + 4, a: p1, b: null };
  w31.a.a = p1;
  p0.b = p1;
  return t29;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h8({ tag: "s24." + o2.n, n: o2.n + 5, a: o1, b: null }, o1, o0, (v) => {
      o2.b = null;
      v.n += 2;
      o1.b = o0;
      return o0;
    }, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 71 === 13) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h2(o2, o1, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 31 === 27) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h6(o1, o2, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 31 === 17) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h5(o2, 0);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 53 === 9) kept.push(r35);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r36 = h8(o0, o0, o0, (v) => {
      o0.a = o1;
      return o2;
    }, 0);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 71 === 5) kept.push(r36);
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
