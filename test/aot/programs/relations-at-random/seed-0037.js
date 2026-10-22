// Made by test/aot/generate-relations-at-random.ts, seed 37: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const o0 = new Made("c0." + p1.n, p1.n + 6, p1);
  const t1 = slot;
  if (o0.n % 53 === 3) kept.push(p1);
  const r2 = h2(p2, o0, f0, d);
  return { tag: "s1." + p2.n, n: p2.n + 9, a: p0, b: null };
}
function h1(p0, p1, p2, f0, d) {
  const r3 = h5.call(null, p2, p1, p1, (v) => {
    p1.b = p0;
    if (p1.n % 71 === 27) slot = p1;
    return p2;
  }, d);
  const g4 = (v) => {
    if (p0 === v) p0.n += 1000;
    p0.a = p0;
    return v;
  };
  let r5 = null;
  try {
    r5 = h7(p0, { tag: "s4." + p0.n, n: p0.n + 1, a: p2, b: null }, p2, d);
  } catch (e) {
    r5 = e;
  }
  return null;
}
function h2(p0, p1, f0, d) {
  const r6 = d > 0 ? h2(p1, new Made("c6." + p0.n, p0.n + 2, p0), (v) => {
    if (p0.n % 41 === 19) kept.push(p0);
    if (p0.n % 41 === 3) slot = p0;
    return p0;
  }, d - 1) : null;
  try {
    if (p0.n % 71 === 27) slot = p0;
    if (p1.n % 89 === 6) throw p1;
  } finally {
    if (p1.n % 53 === 16) kept.push(p1);
  }
  if (p1.n % 37 === 8) holder.hold(p0);
  if (p0.n % 89 === 29) keptFunctions.push(f0);
  if (p0.n % 37 === 29) holder.hold(p0);
  return p1;
}
function h3(p0, p1, p2, d) {
  let c7 = p2;
  for (let k = 0; k < 3; k++) c7 = c7.b ?? p1;
  const o8 = { tag: "s9." + c7.n, n: c7.n + 4, a: p1, b: null };
  for (const v of both(o8, o8)) {
    if (o8 === c7) o8.n += 1000;
  }
  if (c7.n % 31 === 0) kept.push(p1);
  return { tag: "s10." + p0.n, n: p0.n + 9, a: null, b: null };
}
function h4(p0, p1, d) {
  p0.b = p1;
  if (p1.n % 89 === 3) throw p1;
  const t9 = bag.get(p1.n % 5) ?? null;
  return p1;
}
function h5(p0, p1, p2, f0, d) {
  p0.b = p1;
  const w10 = { tag: "s12." + p0.n, n: p0.n + 1, a: p0, b: null };
  w10.a.b = p1;
  const o11 = { tag: "s13." + p0.n, n: p0.n + 6, a: p2, b: null };
  const t12 = slot;
  if (p0.n % 41 === 22) throw p1;
  const r13 = h7(new Made("c14." + p1.n, p1.n + 6, p1), p0, p2, d);
  return p2;
}
function h6(p0, p1, p2, d) {
  const r14 = d > 0 ? h6(p0, { tag: "s16." + p2.n, n: p2.n + 6, a: null, b: null }, new Made("c17." + p2.n, p2.n + 6, p1), d - 1) : null;
  const t15 = p0.b;
  const l16 = [p0, p1];
  l16[0].a = p1;
  const t17 = holder.take();
  let c18 = p2;
  for (let k = 0; k < 3; k++) c18 = c18.a ?? p0;
  return t15;
}
function h7(p0, p1, p2, d) {
  if (p0.n % 89 === 21) slot = p0;
  for (const v of both(p2, p0)) {
    if (p0 === p1) p0.n += 1000;
  }
  const t19 = slot;
  const t20 = holder.take();
  if (p1.n % 37 === 10) holder.hold(p2);
  return p2;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h2(o1, o2, (v) => {
      o2.a = null;
      return { tag: "s20." + v.n, n: v.n + 7, a: o1, b: null };
    }, 2);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 37 === 12) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h3(o1, { tag: "s21." + o1.n, n: o1.n + 9, a: o1, b: null }, { tag: "s22." + o0.n, n: o0.n + 6, a: o0, b: null }, 0);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 8) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h1(o1, { tag: "s23." + o0.n, n: o0.n + 9, a: null, b: null }, o2, (v) => {
      o2.b = v;
      return null;
    }, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 41 === 18) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h4({ tag: "s25." + o1.n, n: o1.n + 4, a: o2, b: null }, o2, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 37 === 1) kept.push(r24);
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
