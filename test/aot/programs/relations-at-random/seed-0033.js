// Made by test/aot/generate-relations-at-random.ts, seed 33: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  bag.set(p0.n % 5, p0);
  if (p1.n % 61 === 12) slot = p1;
  for (const v of both(p2, p2)) {
    if (p1.n % 53 === 17) slot = v;
  }
  return new Made("c0." + p0.n, p0.n + 5, p1);
}
function h1(p0, d) {
  const r0 = h5.apply(null, [p0, p0, p0, (v) => {
    if (p0.n % 71 === 22) kept.push(p0);
    if (v.n % 71 === 29) slot = v;
    return { tag: "s1." + v.n, n: v.n + 7, a: p0, b: null };
  }, d]);
  const t1 = p0.b;
  if (p0.n % 89 === 24) throw p0;
  return t1;
}
function h2(p0, p1, p2, f0, d) {
  if (p2.n % 89 === 0) keptFunctions.push(f0);
  p2.a = null;
  bag.set(p0.n % 5, p2);
  let c2 = p0;
  for (let k = 0; k < 3; k++) c2 = c2.b ?? p2;
  const r3 = h6({ tag: "s3." + p0.n, n: p0.n + 2, a: null, b: null }, { tag: "s4." + p1.n, n: p1.n + 2, a: null, b: null }, p2, d);
  return r3;
}
function h3(p0, p1, d) {
  let r4 = null;
  try {
    r4 = h5(new Made("c6." + p1.n, p1.n + 1, null), p0, p0, (v) => {
      if (p1 === p0) p1.n += 1000;
      return { tag: "s7." + v.n, n: v.n + 1, a: null, b: null };
    }, d);
  } catch (e) {
    r4 = e;
  }
  const r5 = h4(p0, p0, p1, (v) => {
    p1.b = p1;
    return p1;
  }, d);
  const r6 = h6(p1, p0, { tag: "s9." + p1.n, n: p1.n + 1, a: p0, b: null }, d);
  const w7 = { tag: "s10." + p1.n, n: p1.n + 8, a: p0, b: null };
  w7.a.a = p0;
  p1.a = p1;
  return null;
}
function h4(p0, p1, p2, f0, d) {
  const o8 = { tag: "s12." + p0.n, n: p0.n + 6, a: p1, b: null };
  const r9 = f0(o8);
  if (p1.n % 71 === 27) keptFunctions.push(f0);
  const t10 = slot;
  const r11 = f0(p0);
  return null;
}
function h5(p0, p1, p2, f0, d) {
  const o12 = { tag: "s14." + p1.n, n: p1.n + 1, a: p2, b: null };
  let r13 = null;
  try {
    r13 = h7(p2, { tag: "s15." + p2.n, n: p2.n + 8, a: o12, b: null }, d);
  } catch (e) {
    r13 = e;
  }
  holder.hold(o12);
  const r14 = h7({ tag: "s16." + p2.n, n: p2.n + 7, a: o12, b: null }, p2, d);
  return { tag: "s17." + p1.n, n: p1.n + 2, a: p2, b: null };
}
function h6(p0, p1, p2, d) {
  p0.b = p1;
  const t15 = bag.get(p2.n % 5) ?? null;
  let r16 = null;
  try {
    r16 = h7(p1, p2, d);
  } catch (e) {
    r16 = e;
  }
  const g17 = first.bind(null, p2);
  const l18 = [p1, p0];
  l18[0].a = p0;
  if (p0 === p1) p0.n += 1000;
  bag.set(p2.n % 5, p1);
  return p2;
}
function h7(p0, p1, d) {
  if (p0.n % 71 === 24) throw p0;
  const g19 = (v) => {
    if (v === p0) v.n += 1000;
    return null;
  };
  for (const v of both(p0, p0)) {
    if (p1.n % 31 === 17) kept.push(p1);
  }
  const t20 = bag.get(p0.n % 5) ?? null;
  return null;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r21 = h0({ tag: "s21." + o0.n, n: o0.n + 7, a: o1, b: null }, { tag: "s22." + o2.n, n: o2.n + 4, a: o2, b: null }, o2, 1);
    if (r21 !== null) {
      sum += r21.n;
      if (r21.n % 53 === 3) kept.push(r21);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r22 = h1(o2, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 89 === 29) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h5(o2, o1, { tag: "s23." + o2.n, n: o2.n + 5, a: o2, b: null }, (v) => {
      if (o2.n % 53 === 8) kept.push(o1);
      o2.a = o2;
      v.n += 2;
      return { tag: "s24." + v.n, n: v.n + 8, a: null, b: null };
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 53 === 19) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h1(o2, 1);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 41 === 25) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h6(o1, o2, o0, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 89 === 25) kept.push(r25);
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
