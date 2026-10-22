// Made by test/aot/generate-relations-at-random.ts, seed 25: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  const r0 = h7.call(null, p2, (v) => {
    p0.n += 1;
    return { tag: "s0." + v.n, n: v.n + 1, a: p1, b: null };
  }, d);
  const r1 = h4(p2, (v) => {
    if (p1 === v) p1.n += 1000;
    if (p2 === v) p2.n += 1000;
    p1.a = v;
    return p1;
  }, d);
  holder.hold(p1);
  const c2 = p0.n % 2 === 0 ? p0 : p0;
  return r1;
}
function h1(p0, p1, p2, f0, d) {
  const r3 = h5.call(null, p0, d);
  const t4 = holder.take();
  p0.b = p0;
  const c5 = p2.n % 2 === 0 ? p2 : p0;
  return p2;
}
function h2(p0, d) {
  const g6 = (v) => {
    if (p0.n % 37 === 24) kept.push(p0);
    p0.a = v;
    v.b = null;
    return p0;
  };
  const g7 = (v) => {
    if (v === v) v.n += 1000;
    if (v === v) v.n += 1000;
    return v;
  };
  const t8 = bag.get(p0.n % 5) ?? null;
  const r9 = g7(p0);
  const t10 = p0.a;
  return r9;
}
function h3(p0, p1, f0, d) {
  const r11 = h5.apply(null, [p0, d]);
  if (r11 !== null) {
    p0.a = r11;
  }
  if (r11 !== null) {
    p0.b = null;
  }
  const o12 = { tag: "s7." + p0.n, n: p0.n + 4, a: null, b: null };
  holder.hold(p0);
  if (p0.n % 89 === 5) holder.hold(o12);
  return p0;
}
function h4(p0, f0, d) {
  p0.n += 1;
  const g13 = first.bind(null, p0);
  for (const v of both(p0, p0)) {
    if (v.n % 71 === 15) slot = p0;
  }
  const c14 = p0.n % 2 === 0 ? p0 : p0;
  if (p0.n % 89 === 15) keptFunctions.push(f0);
  return { tag: "s9." + p0.n, n: p0.n + 1, a: c14, b: null };
}
function h5(p0, d) {
  const t15 = slot;
  let r16 = null;
  try {
    r16 = h6(p0, d);
  } catch (e) {
    r16 = e;
  }
  const t17 = bag.get(p0.n % 5) ?? null;
  const t18 = holder.take();
  const l19 = [p0, p0];
  l19[1].b = p0;
  if (p0.n % 53 === 6) slot = p0;
  return t17;
}
function h6(p0, d) {
  const r20 = h7(p0, (v) => {
    v.a = null;
    if (v.n % 71 === 17) kept.push(v);
    v.b = p0;
    return v;
  }, d);
  const c21 = p0.n % 2 === 0 ? p0 : p0;
  let c22 = c21;
  for (let k = 0; k < 3; k++) c22 = c22.b ?? c21;
  const g23 = first.bind(null, c22);
  const r24 = h7.call(null, { tag: "s12." + c22.n, n: c22.n + 7, a: null, b: null }, g23, d);
  const t25 = c22.a;
  const r26 = h7({ tag: "s13." + c21.n, n: c21.n + 5, a: p0, b: null }, g23, d);
  const t27 = slot;
  return null;
}
function h7(p0, f0, d) {
  bag.set(p0.n % 5, p0);
  const t28 = p0.a;
  const o29 = { tag: "s15." + p0.n, n: p0.n + 1, a: null, b: null };
  return o29;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r30 = h0(new Made("c17." + o1.n, o1.n + 3, null), o1, o2, 1);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 41 === 27) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h4(o2, (v) => {
      v.a = o1;
      o1.b = o2;
      if (o0 === v) o0.n += 1000;
      return new Made("c18." + v.n, v.n + 6, o2);
    }, 2);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 41 === 20) kept.push(r31);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r32 = h5(o1, 0);
    if (r32 !== null) {
      sum += r32.n;
      if (r32.n % 37 === 15) kept.push(r32);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r33 = h1(o0, o1, o0, (v) => {
      v.b = null;
      if (o1.n % 31 === 1) slot = o0;
      v.b = o0;
      return v;
    }, 2);
    if (r33 !== null) {
      sum += r33.n;
      if (r33.n % 71 === 22) kept.push(r33);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r34 = h4(o1, (v) => {
      v.n += 3;
      o1.n += 2;
      if (o1 === o0) o1.n += 1000;
      return o0;
    }, 1);
    if (r34 !== null) {
      sum += r34.n;
      if (r34.n % 89 === 18) kept.push(r34);
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
