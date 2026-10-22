// Made by test/aot/generate-relations-at-random.ts, seed 65: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p1.n % 37 === 29) holder.hold(p1);
  if (p0.n % 31 === 26) slot = p1;
  bag.set(p1.n % 5, p0);
  const o0 = new Made("c0." + p1.n, p1.n + 3, p1);
  const w1 = { tag: "s1." + p0.n, n: p0.n + 4, a: o0, b: null };
  w1.a.b = p0;
  return o0;
}
function h1(p0, p1, p2, f0, d) {
  let c2 = p0;
  for (let k = 0; k < 3; k++) c2 = c2.a ?? p2;
  const g3 = (v) => {
    c2.b = v;
    if (p1 === p2) p1.n += 1000;
    return p2;
  };
  const t4 = slot;
  const c5 = p0.n % 2 === 0 ? p0 : p2;
  try {
    if (c2 === p1) c2.n += 1000;
    if (p2.n % 89 === 14) throw p1;
  } finally {
    p1.a = c2;
  }
  c5.b = null;
  const r6 = d > 0 ? h1(c2, c5, p1, (v) => {
    if (c2.n % 37 === 4) kept.push(c5);
    p2.b = p2;
    if (p2 === v) p2.n += 1000;
    return p1;
  }, d - 1) : null;
  return c5;
}
function h2(p0, d) {
  let r7 = null;
  try {
    r7 = h3(p0, p0, p0, d);
  } catch (e) {
    r7 = e;
  }
  const g8 = first.bind(null, p0);
  let r9 = null;
  try {
    r9 = h3(p0, p0, new Made("c6." + p0.n, p0.n + 6, p0), d);
  } catch (e) {
    r9 = e;
  }
  const w10 = { tag: "s7." + p0.n, n: p0.n + 5, a: p0, b: null };
  w10.a.a = p0;
  for (const v of both(p0, p0)) {
    p0.n += 1;
  }
  return p0;
}
function h3(p0, p1, p2, d) {
  try {
    if (p0 === p2) p0.n += 1000;
    if (p1.n % 37 === 7) throw p0;
  } finally {
    if (p2.n % 89 === 18) slot = p0;
  }
  const r11 = d > 0 ? h3(p0, p1, p0, d - 1) : null;
  holder.hold(p0);
  const t12 = slot;
  let c13 = p0;
  for (let k = 0; k < 3; k++) c13 = c13.a ?? p1;
  holder.hold(p1);
  const r14 = h4.apply(null, [p2, (v) => {
    if (p0.n % 53 === 24) kept.push(p2);
    p0.a = null;
    return v;
  }, d]);
  return r14;
}
function h4(p0, f0, d) {
  const r15 = d > 0 ? h4(p0, f0, d - 1) : null;
  const c16 = p0.n % 2 === 0 ? p0 : p0;
  const l17 = [c16, p0];
  l17[0].a = p0;
  return { tag: "s11." + c16.n, n: c16.n + 3, a: null, b: null };
}
function h5(p0, p1, p2, d) {
  const g18 = (v) => {
    if (p2.n % 71 === 5) kept.push(p1);
    p1.b = p2;
    if (p1.n % 41 === 19) kept.push(p0);
    return v;
  };
  const g19 = (v) => {
    p2.a = p0;
    p2.a = p2;
    v.b = p0;
    return null;
  };
  for (const v of both(p0, p0)) {
    p2.a = p1;
  }
  return p0;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r20 = h1(new Made("c15." + o2.n, o2.n + 3, o0), { tag: "s16." + o0.n, n: o0.n + 9, a: null, b: null }, o0, (v) => {
      o0.b = null;
      v.b = o0;
      return v;
    }, 1);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 71 === 16) kept.push(r20);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r21 = h0({ tag: "s18." + o0.n, n: o0.n + 5, a: o0, b: null }, { tag: "s19." + o1.n, n: o1.n + 8, a: o2, b: null }, 2);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 61 === 2) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h3(new Made("c20." + o0.n, o0.n + 5, null), { tag: "s21." + o2.n, n: o2.n + 3, a: o1, b: null }, o0, 1);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 14) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h4(o2, (v) => {
      o2.b = null;
      return o2;
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 41 === 2) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h4(o0, (v) => {
      if (o2.n % 89 === 0) kept.push(o2);
      if (o0.n % 71 === 2) kept.push(v);
      return null;
    }, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 61 === 20) kept.push(r24);
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
