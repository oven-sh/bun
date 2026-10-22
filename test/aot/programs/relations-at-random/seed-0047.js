// Made by test/aot/generate-relations-at-random.ts, seed 47: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  if (p0 === p0) p0.n += 1000;
  const t0 = holder.take();
  const t1 = p0.a;
  p0.n += 4;
  const t2 = slot;
  return p0;
}
function h1(p0, p1, d) {
  const l3 = [p1, p1];
  l3[1].a = p0;
  let c4 = p0;
  for (let k = 0; k < 3; k++) c4 = c4.b ?? p0;
  const g5 = (v) => {
    if (v === p1) v.n += 1000;
    return p0;
  };
  const g6 = (v) => {
    if (p0.n % 31 === 1) kept.push(v);
    if (v.n % 53 === 21) kept.push(p0);
    p1.a = null;
    return p0;
  };
  const l7 = [p0, p0];
  l7[0].b = p0;
  return null;
}
function h2(p0, p1, d) {
  const r8 = h4.apply(null, [{ tag: "s4." + p0.n, n: p0.n + 7, a: p0, b: null }, p0, (v) => {
    if (v === p0) v.n += 1000;
    return v;
  }, d]);
  const g9 = (v) => {
    if (p1.n % 89 === 4) kept.push(v);
    return p1;
  };
  const w10 = { tag: "s7." + p1.n, n: p1.n + 6, a: p1, b: null };
  w10.a.a = p1;
  return r8;
}
function h3(p0, p1, f0, d) {
  const g11 = (v) => {
    p1.a = p0;
    if (p0 === p1) p0.n += 1000;
    return null;
  };
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 61 === 4) throw p1;
  } finally {
    p1.b = null;
  }
  p1.a = null;
  if (p1 === p0) p1.n += 1000;
  const r12 = h5({ tag: "s10." + p1.n, n: p1.n + 5, a: null, b: null }, (v) => {
    p1.a = p1;
    return p0;
  }, d);
  holder.hold(p0);
  for (const v of both(p0, p1)) {
    if (p1.n % 31 === 21) slot = v;
  }
  return p0;
}
function h4(p0, p1, f0, d) {
  holder.hold(p1);
  const w13 = { tag: "s13." + p1.n, n: p1.n + 6, a: p1, b: null };
  w13.a.a = p1;
  let c14 = p0;
  for (let k = 0; k < 3; k++) c14 = c14.a ?? p1;
  const r15 = h8(p1, d);
  if (p1.n % 41 === 4) keptFunctions.push(f0);
  if (c14.n % 71 === 11) slot = c14;
  return r15;
}
function h5(p0, f0, d) {
  holder.hold(p0);
  const r16 = h6.apply(null, [p0, d]);
  const t17 = slot;
  return r16;
}
function h6(p0, d) {
  let r18 = null;
  try {
    r18 = h7(p0, p0, d);
  } catch (e) {
    r18 = e;
  }
  let r19 = null;
  try {
    r19 = h7(p0, new Made("c16." + p0.n, p0.n + 8, p0), d);
  } catch (e) {
    r19 = e;
  }
  const t20 = bag.get(p0.n % 5) ?? null;
  const g21 = first.bind(null, p0);
  const g22 = first.bind(null, p0);
  if (t20 !== null) {
    if (p0.n % 53 === 27) kept.push(p0);
  }
  const o23 = { tag: "s17." + p0.n, n: p0.n + 1, a: p0, b: null };
  return o23;
}
function h7(p0, p1, d) {
  p0.n += 2;
  if (p0.n % 53 === 10) holder.hold(p1);
  const g24 = (v) => {
    if (p1 === p1) p1.n += 1000;
    return null;
  };
  bag.set(p1.n % 5, p1);
  const c25 = p0.n % 2 === 0 ? p0 : p0;
  const g26 = (v) => {
    if (p1.n % 37 === 9) slot = v;
    if (p0.n % 37 === 10) kept.push(p0);
    p0.b = null;
    return new Made("c20." + v.n, v.n + 1, c25);
  };
  let c27 = p0;
  for (let k = 0; k < 3; k++) c27 = c27.a ?? p0;
  return p1;
}
function h8(p0, d) {
  const t28 = holder.take();
  for (const v of both(p0, p0)) {
    if (v.n % 37 === 22) kept.push(p0);
  }
  const l29 = [p0, p0];
  l29[0].a = p0;
  const l30 = [p0, p0];
  l30[0].b = p0;
  const t31 = slot;
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h4(o1, o0, (v) => {
      o2.b = null;
      v.a = v;
      return v;
    }, 1);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 41 === 5) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h2(o2, o0, 0);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 53 === 17) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h5(o0, (v) => {
      o2.b = o0;
      return null;
    }, 2);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 61 === 18) kept.push(r34);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r35 = h5(o2, (v) => {
      if (o2 === o2) o2.n += 1000;
      o1.a = o0;
      o0.a = o0;
      return null;
    }, 1);
    if (r35 !== null) {
      sum += r35.n;
      if (r35.n % 89 === 8) kept.push(r35);
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
