// Made by test/aot/generate-relations-at-random.ts, seed 45: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c0 = p1.n % 2 === 0 ? p1 : p2;
  const r1 = h2.call(null, c0, p1, (v) => {
    v.n += 1;
    return p0;
  }, d);
  const t2 = bag.get(p1.n % 5) ?? null;
  return p1;
}
function h1(p0, p1, d) {
  const t3 = holder.take();
  let r4 = null;
  try {
    r4 = h2(new Made("c2." + p1.n, p1.n + 4, null), p1, (v) => {
      p0.a = v;
      if (p1.n % 71 === 13) kept.push(p1);
      return p1;
    }, d);
  } catch (e) {
    r4 = e;
  }
  const r5 = d > 0 ? h1(p1, p0, d - 1) : null;
  const c6 = p1.n % 2 === 0 ? p1 : p1;
  const r7 = d > 0 ? h1(p1, p0, d - 1) : null;
  return r4;
}
function h2(p0, p1, f0, d) {
  if (p0.n % 53 === 1) throw p0;
  const o8 = { tag: "s5." + p0.n, n: p0.n + 9, a: p1, b: null };
  const g9 = (v) => {
    p0.b = p1;
    v.b = v;
    if (o8.n % 41 === 9) kept.push(p0);
    return v;
  };
  for (const v of both(p1, p1)) {
    p0.a = p1;
  }
  const t10 = slot;
  bag.set(p1.n % 5, o8);
  const r11 = g9(p1);
  return { tag: "s7." + p1.n, n: p1.n + 9, a: null, b: null };
}
function h3(p0, p1, p2, d) {
  const w12 = new Made("c8." + p2.n, p2.n + 5, p1);
  w12.a.a = p0;
  const c13 = p0.n % 2 === 0 ? p0 : p2;
  p1.a = p1;
  if (p1.n % 53 === 22) throw p0;
  try {
    p1.a = p1;
    if (c13.n % 89 === 3) throw p1;
  } finally {
    c13.b = p2;
  }
  return p0;
}
function h4(p0, p1, p2, d) {
  if (p1.n % 53 === 23) kept.push(p1);
  const c14 = p0.n % 2 === 0 ? p0 : p1;
  if (p0.n % 53 === 22) throw p2;
  bag.set(c14.n % 5, p2);
  return null;
}
function h5(p0, p1, p2, f0, d) {
  const o15 = new Made("c11." + p2.n, p2.n + 3, p2);
  const r16 = f0(p1);
  const t17 = p0.b;
  try {
    if (p0 === p2) p0.n += 1000;
    if (p2.n % 31 === 29) throw p1;
  } finally {
    p2.b = p0;
  }
  return { tag: "s12." + o15.n, n: o15.n + 5, a: p0, b: null };
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r18 = h2(o1, o1, (v) => {
      o1.b = o1;
      o0.b = null;
      return o0;
    }, 2);
    if (r18 !== null) {
      sum += r18.n;
      if (r18.n % 71 === 13) kept.push(r18);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r19 = h2(new Made("c14." + o0.n, o0.n + 3, o1), { tag: "s15." + o1.n, n: o1.n + 2, a: o0, b: null }, (v) => {
      if (o1 === o1) o1.n += 1000;
      v.a = null;
      return o2;
    }, 1);
    if (r19 !== null) {
      sum += r19.n;
      if (r19.n % 37 === 18) kept.push(r19);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r20 = h3(o1, { tag: "s17." + o0.n, n: o0.n + 4, a: o2, b: null }, new Made("c18." + o1.n, o1.n + 2, null), 1);
    if (r20 !== null) {
      sum += r20.n;
      if (r20.n % 61 === 7) kept.push(r20);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r21 = h4(o1, o2, o2, 0);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 61 === 2) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h2(o1, { tag: "s19." + o0.n, n: o0.n + 6, a: o0, b: null }, (v) => {
      if (v.n % 71 === 13) kept.push(o1);
      return { tag: "s20." + v.n, n: v.n + 5, a: o1, b: null };
    }, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 61 === 14) kept.push(r22);
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
