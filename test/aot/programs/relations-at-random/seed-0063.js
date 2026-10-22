// Made by test/aot/generate-relations-at-random.ts, seed 63: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
function h0(p0, f0, d) {
  const r0 = h1(p0, f0, d);
  if (p0.n % 89 === 25) keptFunctions.push(f0);
  p0.b = p0;
  bag.set(p0.n % 5, p0);
  try {
    if (p0.n % 31 === 5) kept.push(p0);
    if (p0.n % 53 === 10) throw p0;
  } finally {
    p0.a = p0;
  }
  return r0;
}
function h1(p0, f0, d) {
  const g1 = (v) => {
    if (p0 === v) p0.n += 1000;
    v.n += 5;
    p0.b = p0;
    return null;
  };
  const r2 = h3.apply(null, [p0, p0, d]);
  let r3 = null;
  try {
    r3 = h3(p0, p0, d);
  } catch (e) {
    r3 = e;
  }
  const r4 = d > 0 ? h1(p0, f0, d - 1) : null;
  return { tag: "s2." + p0.n, n: p0.n + 7, a: p0, b: null };
}
function h2(p0, p1, p2, f0, d) {
  const r5 = h6(new Made("c3." + p1.n, p1.n + 2, p0), p1, { tag: "s4." + p1.n, n: p1.n + 8, a: p2, b: null }, d);
  const l6 = [p1, p1];
  l6[1].a = p0;
  const r7 = h3(p0, p2, d);
  const c8 = p0.n % 2 === 0 ? p0 : p0;
  const w9 = { tag: "s5." + p1.n, n: p1.n + 2, a: p2, b: null };
  w9.a.a = p1;
  return r5;
}
function h3(p0, p1, d) {
  if (p1.n % 37 === 9) throw p0;
  p0.a = p0;
  const g10 = (v) => {
    if (v.n % 71 === 4) kept.push(v);
    if (p0 === p0) p0.n += 1000;
    return null;
  };
  bag.set(p0.n % 5, p0);
  return p0;
}
function h4(p0, f0, d) {
  let r11 = null;
  try {
    r11 = h6(p0, p0, new Made("c9." + p0.n, p0.n + 5, p0), d);
  } catch (e) {
    r11 = e;
  }
  for (const v of both(p0, p0)) {
    if (v.n % 31 === 3) slot = v;
  }
  try {
    if (p0 === p0) p0.n += 1000;
    if (p0.n % 37 === 2) throw p0;
  } finally {
    if (p0.n % 31 === 9) kept.push(p0);
  }
  const g12 = first.bind(null, p0);
  let c13 = p0;
  for (let k = 0; k < 3; k++) c13 = c13.b ?? p0;
  const c14 = p0.n % 2 === 0 ? p0 : c13;
  return p0;
}
function h5(p0, f0, d) {
  let r15 = null;
  try {
    r15 = h6(p0, p0, p0, d);
  } catch (e) {
    r15 = e;
  }
  const t16 = slot;
  for (const v of both(p0, p0)) {
    if (v === v) v.n += 1000;
  }
  if (p0.n % 41 === 18) holder.hold(p0);
  p0.b = p0;
  let c17 = p0;
  for (let k = 0; k < 3; k++) c17 = c17.a ?? p0;
  const r18 = h6(p0, { tag: "s11." + c17.n, n: c17.n + 1, a: c17, b: null }, { tag: "s12." + p0.n, n: p0.n + 7, a: p0, b: null }, d);
  const t19 = slot;
  return r15;
}
function h6(p0, p1, p2, d) {
  if (p0.n % 61 === 23) slot = p2;
  const t20 = p1.b;
  const r21 = d > 0 ? h6(p1, p1, p0, d - 1) : null;
  const t22 = holder.take();
  return r21;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r23 = h2({ tag: "s15." + o0.n, n: o0.n + 9, a: o1, b: null }, o2, o2, (v) => {
      o2.a = o1;
      o1.n += 1;
      return null;
    }, 2);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 53 === 18) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h0(o0, (v) => {
      v.n += 2;
      v.n += 5;
      v.n += 2;
      return v;
    }, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 53 === 7) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h5({ tag: "s18." + o0.n, n: o0.n + 7, a: o0, b: null }, (v) => {
      o1.b = null;
      o0.b = v;
      return o0;
    }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 37 === 17) kept.push(r25);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r26 = h4(new Made("c20." + o2.n, o2.n + 2, null), (v) => {
      o0.a = null;
      return o1;
    }, 2);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 89 === 25) kept.push(r26);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r27 = h4(o2, (v) => {
      if (v.n % 53 === 4) kept.push(v);
      return o2;
    }, 1);
    if (r27 !== null) {
      sum += r27.n;
      if (r27.n % 71 === 18) kept.push(r27);
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
