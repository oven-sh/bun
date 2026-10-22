// Made by test/aot/generate-relations-at-random.ts, seed 77: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  try {
    p0.a = p0;
    if (p0.n % 37 === 6) throw p0;
  } finally {
    p0.n += 3;
  }
  for (const v of both(p0, p0)) {
    if (p0 === v) p0.n += 1000;
  }
  return p0;
}
function h1(p0, p1, f0, d) {
  const w0 = { tag: "s1." + p0.n, n: p0.n + 3, a: p1, b: null };
  w0.a.a = p0;
  let r1 = null;
  try {
    r1 = h4(p0, d);
  } catch (e) {
    r1 = e;
  }
  let r2 = null;
  try {
    r2 = h4(p1, d);
  } catch (e) {
    r2 = e;
  }
  if (p1.n % 53 === 15) keptFunctions.push(f0);
  p0.a = p0;
  const t3 = slot;
  const t4 = slot;
  const l5 = [p1, p0];
  l5[1].b = p1;
  return { tag: "s2." + p1.n, n: p1.n + 5, a: p0, b: null };
}
function h2(p0, p1, p2, d) {
  const r6 = h3(p0, p1, new Made("c3." + p1.n, p1.n + 2, p1), (v) => {
    if (p1.n % 37 === 15) slot = v;
    return null;
  }, d);
  const { a: t7 } = p1;
  if (p1.n % 31 === 5) holder.hold(p2);
  p1.a = null;
  return new Made("c5." + p1.n, p1.n + 7, null);
}
function h3(p0, p1, p2, f0, d) {
  const c8 = p1.n % 2 === 0 ? p1 : p0;
  const t9 = c8.a;
  const w10 = { tag: "s6." + p1.n, n: p1.n + 4, a: c8, b: null };
  w10.a.b = p1;
  const t11 = bag.get(c8.n % 5) ?? null;
  const l12 = [p2, p1];
  l12[0].b = c8;
  p0.b = p2;
  let c13 = p1;
  for (let k = 0; k < 3; k++) c13 = c13.b ?? p0;
  return c13;
}
function h4(p0, d) {
  const g14 = first.bind(null, p0);
  const r15 = h5({ tag: "s8." + p0.n, n: p0.n + 3, a: p0, b: null }, p0, d);
  const r16 = d > 0 ? h4(new Made("c9." + p0.n, p0.n + 1, null), d - 1) : null;
  let c17 = p0;
  for (let k = 0; k < 3; k++) c17 = c17.a ?? p0;
  const r18 = h7(p0, (v) => {
    if (p0.n % 71 === 19) kept.push(v);
    v.a = p0;
    if (v === c17) v.n += 1000;
    return null;
  }, d);
  return p0;
}
function h5(p0, p1, d) {
  const c19 = p1.n % 2 === 0 ? p1 : p0;
  p0.b = c19;
  if (p1.n % 53 === 2) throw c19;
  return p0;
}
function h6(p0, p1, p2, d) {
  let c20 = p1;
  for (let k = 0; k < 3; k++) c20 = c20.b ?? p0;
  let c21 = c20;
  for (let k = 0; k < 3; k++) c21 = c21.b ?? c20;
  const g22 = first.bind(null, p1);
  const c23 = c21.n % 2 === 0 ? c21 : c21;
  const r24 = g22(c20);
  const r25 = h7(p2, g22, d);
  return p2;
}
function h7(p0, f0, d) {
  const o26 = new Made("c14." + p0.n, p0.n + 5, p0);
  const g27 = (v) => {
    if (o26 === v) o26.n += 1000;
    p0.b = null;
    return v;
  };
  try {
    if (p0.n % 41 === 7) slot = p0;
    if (p0.n % 61 === 17) throw o26;
  } finally {
    if (o26.n % 61 === 21) slot = p0;
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
    const r28 = h6(o2, o0, { tag: "s17." + o0.n, n: o0.n + 6, a: null, b: null }, 2);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 89 === 19) kept.push(r28);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r29 = h3(o2, o2, { tag: "s18." + o0.n, n: o0.n + 9, a: o2, b: null }, (v) => {
      o1.a = o0;
      return o1;
    }, 2);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 37 === 2) kept.push(r29);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r30 = h6(o2, new Made("c20." + o0.n, o0.n + 9, o0), o1, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 61 === 16) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h7(o1, (v) => {
      o1.n += 4;
      if (o1 === o1) o1.n += 1000;
      return o1;
    }, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 61 === 13) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h2({ tag: "s22." + o0.n, n: o0.n + 7, a: o1, b: null }, { tag: "s23." + o1.n, n: o1.n + 7, a: o2, b: null }, o1, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 61 === 10) kept.push(r32);
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
