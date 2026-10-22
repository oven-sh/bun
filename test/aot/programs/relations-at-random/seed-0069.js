// Made by test/aot/generate-relations-at-random.ts, seed 69: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c1 = p0.n % 2 === 0 ? p0 : p0;
  if (p0.n % 89 === 26) slot = p0;
  const o2 = { tag: "s0." + p0.n, n: p0.n + 3, a: p0, b: null };
  const r3 = h7(c1, (v) => {
    if (c1.n % 61 === 11) slot = v;
    if (v.n % 37 === 12) slot = c1;
    return v;
  }, d);
  try {
    if (c1 === p0) c1.n += 1000;
    if (p0.n % 89 === 6) throw c1;
  } finally {
    if (o2.n % 37 === 28) slot = p0;
  }
  const c4 = p0.n % 2 === 0 ? p0 : c1;
  return c4;
}
function h1(p0, p1, p2, d) {
  const w5 = { tag: "s3." + p1.n, n: p1.n + 1, a: p1, b: null };
  w5.a.b = p2;
  const r6 = d > 0 ? h1(p1, { tag: "s4." + p1.n, n: p1.n + 1, a: null, b: null }, p0, d - 1) : null;
  try {
    p1.n += 2;
    if (p2.n % 71 === 3) throw p1;
  } finally {
    p2.a = null;
  }
  const r7 = h7(p1, (v) => {
    if (p1.n % 31 === 25) kept.push(v);
    return null;
  }, d);
  const r8 = d > 0 ? h1(p2, p1, p0, d - 1) : null;
  const g9 = (v) => {
    if (v === p0) v.n += 1000;
    return p2;
  };
  const t10 = bag.get(p1.n % 5) ?? null;
  return r7;
}
function h2(p0, p1, d) {
  const t11 = holder.take();
  const l12 = [p1, p0];
  l12[1].b = p0;
  try {
    if (p0.n % 37 === 21) kept.push(p0);
    if (p1.n % 61 === 0) throw p0;
  } finally {
    if (p0 === p1) p0.n += 1000;
  }
  p0.n += 2;
  const l13 = [p1, p0];
  l13[0].a = p0;
  const g14 = (v) => {
    if (p0.n % 71 === 8) slot = p0;
    return v;
  };
  for (const v of both(p0, p1)) {
    p0.n += 5;
  }
  return { tag: "s9." + p0.n, n: p0.n + 4, a: null, b: null };
}
function h3(p0, d) {
  if (p0.n % 37 === 29) throw p0;
  const r15 = h5.call(null, p0, { tag: "s10." + p0.n, n: p0.n + 4, a: null, b: null }, d);
  if (p0 === p0) p0.n += 1000;
  let r16 = null;
  try {
    r16 = h8(p0, d);
  } catch (e) {
    r16 = e;
  }
  let c17 = p0;
  for (let k = 0; k < 3; k++) c17 = c17.a ?? p0;
  const r18 = h4.apply(null, [p0, c17, c17, d]);
  return new Made("c11." + c17.n, c17.n + 2, p0);
}
function h4(p0, p1, p2, d) {
  const t19 = slot;
  bag.set(p2.n % 5, p1);
  for (const v of both(p0, p1)) {
    if (p0.n % 31 === 29) kept.push(p1);
  }
  const r20 = h7.apply(null, [{ tag: "s12." + p2.n, n: p2.n + 7, a: p0, b: null }, (v) => {
    if (p0 === p1) p0.n += 1000;
    return v;
  }, d]);
  const r21 = d > 0 ? h4(new Made("c14." + p2.n, p2.n + 2, p1), new Made("c15." + p0.n, p0.n + 5, null), p0, d - 1) : null;
  return null;
}
function h5(p0, p1, d) {
  holder.hold(p1);
  const c22 = p0.n % 2 === 0 ? p0 : p1;
  const t23 = holder.take();
  let r24 = null;
  try {
    r24 = h8(c22, d);
  } catch (e) {
    r24 = e;
  }
  const g25 = (v) => {
    if (p1 === c22) p1.n += 1000;
    c22.a = v;
    if (c22.n % 53 === 26) slot = v;
    return v;
  };
  if (c22.n % 71 === 13) throw c22;
  if (c22 === c22) c22.n += 1000;
  c22.a = p0;
  return new Made("c18." + p0.n, p0.n + 2, p1);
}
function h6(p0, p1, d) {
  bag.set(p0.n % 5, p1);
  return { tag: "s19." + p0.n, n: p0.n + 1, a: p1, b: null };
}
function h7(p0, f0, d) {
  const g26 = first.bind(null, p0);
  const r27 = h8(new Made("c20." + p0.n, p0.n + 6, null), d);
  const l28 = [p0, p0];
  l28[1].a = p0;
  let r29 = null;
  try {
    r29 = h8(p0, d);
  } catch (e) {
    r29 = e;
  }
  return r27;
}
function h8(p0, d) {
  const c30 = p0.n % 2 === 0 ? p0 : p0;
  const g31 = first.bind(null, p0);
  return c30;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h1({ tag: "s23." + o1.n, n: o1.n + 9, a: o0, b: null }, new Made("c24." + o0.n, o0.n + 3, o0), { tag: "s25." + o0.n, n: o0.n + 4, a: o2, b: null }, 2);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 37 === 20) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h4(new Made("c26." + o1.n, o1.n + 5, o0), { tag: "s27." + o1.n, n: o1.n + 2, a: o2, b: null }, { tag: "s28." + o0.n, n: o0.n + 7, a: o1, b: null }, 1);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 61 === 16) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h0({ tag: "s29." + o0.n, n: o0.n + 9, a: o1, b: null }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 71 === 27) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h2(o1, o0, 1);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 31 === 1) kept.push(r35);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r36 = h7(new Made("c30." + o1.n, o1.n + 8, o0), (v) => {
      if (o2 === o1) o2.n += 1000;
      v.b = v;
      return o0;
    }, 0);
    if (r36 !== null) {
      sum += r36.n;
      if (r36.n % 37 === 26) kept.push(r36);
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
