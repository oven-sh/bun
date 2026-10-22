// Made by test/aot/generate-relations-at-random.ts, seed 79: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const c0 = p2.n % 2 === 0 ? p2 : p2;
  if (p0.n % 89 === 27) throw c0;
  try {
    if (p0 === p0) p0.n += 1000;
    if (p2.n % 89 === 1) throw p0;
  } finally {
    if (c0 === p2) c0.n += 1000;
  }
  return c0;
}
function h1(p0, p1, d) {
  try {
    p0.a = p0;
    if (p0.n % 31 === 23) throw p0;
  } finally {
    p0.a = null;
  }
  const l1 = [p1, p0];
  l1[0].a = p0;
  p0.n += 2;
  const l2 = [p1, p0];
  l2[0].a = p0;
  p0.b = null;
  return p0;
}
function h2(p0, f0, d) {
  const r3 = h3.call(null, { tag: "s2." + p0.n, n: p0.n + 8, a: p0, b: null }, (v) => {
    if (p0.n % 41 === 21) kept.push(v);
    if (v === v) v.n += 1000;
    return null;
  }, d);
  let c4 = p0;
  for (let k = 0; k < 3; k++) c4 = c4.b ?? p0;
  const g5 = first.bind(null, p0);
  const t6 = holder.take();
  holder.hold(c4);
  const t7 = c4.b;
  return p0;
}
function h3(p0, f0, d) {
  const r8 = h5.apply(null, [p0, d]);
  const g9 = first.bind(null, p0);
  const t10 = p0.a;
  holder.hold(p0);
  let c11 = p0;
  for (let k = 0; k < 3; k++) c11 = c11.a ?? p0;
  return r8;
}
function h4(p0, f0, d) {
  if (p0.n % 61 === 29) keptFunctions.push(f0);
  const r12 = h5.call(null, p0, d);
  const r13 = d > 0 ? h4(p0, f0, d - 1) : null;
  const t14 = holder.take();
  const c15 = p0.n % 2 === 0 ? p0 : p0;
  return r13;
}
function h5(p0, d) {
  bag.set(p0.n % 5, p0);
  const t16 = bag.get(p0.n % 5) ?? null;
  const l17 = [p0, p0];
  l17[1].a = p0;
  const c18 = p0.n % 2 === 0 ? p0 : p0;
  const w19 = { tag: "s7." + p0.n, n: p0.n + 9, a: p0, b: null };
  w19.a.b = p0;
  const g20 = (v) => {
    v.b = v;
    p0.n += 1;
    if (p0 === c18) p0.n += 1000;
    return c18;
  };
  const t21 = bag.get(p0.n % 5) ?? null;
  return c18;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r22 = h2(o1, (v) => {
      if (o1 === o1) o1.n += 1000;
      o0.b = o2;
      return v;
    }, 2);
    if (r22 !== null) {
      sum += r22.n;
      if (r22.n % 71 === 28) kept.push(r22);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r23 = h4(o2, (v) => {
      if (o1.n % 53 === 21) slot = v;
      return o1;
    }, 1);
    if (r23 !== null) {
      sum += r23.n;
      if (r23.n % 31 === 23) kept.push(r23);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r24 = h4(o1, (v) => {
      v.a = o2;
      o1.b = o1;
      o1.b = o1;
      return null;
    }, 0);
    if (r24 !== null) {
      sum += r24.n;
      if (r24.n % 37 === 9) kept.push(r24);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r25 = h4(o2, (v) => {
      if (o1 === v) o1.n += 1000;
      return o2;
    }, 0);
    if (r25 !== null) {
      sum += r25.n;
      if (r25.n % 71 === 24) kept.push(r25);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r26 = h4(o0, (v) => {
      o0.b = o1;
      if (v.n % 41 === 27) kept.push(o2);
      return null;
    }, 2);
    if (r26 !== null) {
      sum += r26.n;
      if (r26.n % 41 === 8) kept.push(r26);
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
