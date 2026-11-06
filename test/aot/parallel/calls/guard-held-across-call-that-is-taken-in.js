// A guard of one field is held across a call on the word of the callee's summary; the callee is then taken in. Once its body was pasted with its accesses by name,
// which count as unknown code, and the build stopped: GuardNotAvailable. One of link-attacks' random programs, as it was made.
// Made by test/aot/generate-relations-at-random.ts, seed 7301: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.
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
  p1.n += 1;
  const t0 = slot;
  const t1 = p0.a;
  if (p0.n % 41 === 12) throw p2;
  return p1;
}
function h1(p0, p1, p2, d) {
  const l2 = [p1, p1];
  l2[1].a = p0;
  const t3 = p2.a;
  const l4 = [p1, p2];
  l4[0].a = p2;
  return null;
}
function h2(p0, p1, f0, d) {
  const c5 = p1.n % 2 === 0 ? p1 : p1;
  const t6 = p1.b;
  let r7 = null;
  try {
    r7 = h6(p0, f0, d);
  } catch (e) {
    r7 = e;
  }
  let r8 = null;
  try {
    r8 = h4(p0, p1, { tag: "s2." + p0.n, n: p0.n + 7, a: c5, b: null }, (v) => {
      if (c5 === p0) c5.n += 1000;
      p0.b = null;
      return p0;
    }, d);
  } catch (e) {
    r8 = e;
  }
  const r9 = d > 0 ? h2(p0, p1, (v) => {
    v.b = null;
    p1.n += 2;
    if (v.n % 37 === 27) slot = c5;
    return p1;
  }, d - 1) : null;
  return { tag: "s5." + p1.n, n: p1.n + 7, a: p1, b: null };
}
function h3(p0, p1, f0, d) {
  const t10 = bag.get(p1.n % 5) ?? null;
  const t11 = slot;
  const r12 = f0(p1);
  try {
    p0.a = null;
    if (p1.n % 37 === 0) throw p0;
  } finally {
    p0.n += 3;
  }
  return { tag: "s6." + p0.n, n: p0.n + 5, a: p1, b: null };
}
function h4(p0, p1, p2, f0, d) {
  for (const v of both(p2, p2)) {
    if (p1 === p0) p1.n += 1000;
  }
  const t13 = holder.take();
  for (const v of both(p1, p1)) {
    p2.b = v;
  }
  let r14 = null;
  try {
    r14 = h6(p1, f0, d);
  } catch (e) {
    r14 = e;
  }
  const t15 = p0.a;
  const t16 = bag.get(p0.n % 5) ?? null;
  const o17 = { tag: "s7." + p2.n, n: p2.n + 2, a: null, b: null };
  bag.set(o17.n % 5, p2);
  return t15;
}
function h5(p0, p1, d) {
  const o18 = { tag: "s9." + p0.n, n: p0.n + 3, a: p0, b: null };
  const t19 = bag.get(p0.n % 5) ?? null;
  const t20 = bag.get(p1.n % 5) ?? null;
  const t21 = holder.take();
  const t22 = holder.take();
  return t19;
}
function h6(p0, f0, d) {
  try {
    p0.b = p0;
    if (p0.n % 71 === 11) throw p0;
  } finally {
    if (p0.n % 61 === 16) kept.push(p0);
  }
  const g23 = (v) => {
    p0.a = p0;
    if (v === v) v.n += 1000;
    p0.n += 2;
    return null;
  };
  const w24 = { tag: "s12." + p0.n, n: p0.n + 3, a: p0, b: null };
  w24.a.b = p0;
  let c25 = p0;
  for (let k = 0; k < 3; k++) c25 = c25.b ?? p0;
  if (p0.n % 53 === 14) throw p0;
  for (const v of both(c25, p0)) {
    v.b = null;
  }
  const t26 = c25.b;
  const c27 = p0.n % 2 === 0 ? p0 : c25;
  return c25;
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r28 = h3(o1, o2, (v) => {
      o1.b = v;
      o2.b = null;
      return o2;
    }, 0);
    if (r28 !== null) {
      sum += r28.n;
      if (r28.n % 61 === 0) kept.push(r28);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r29 = h4(o2, { tag: "s15." + o1.n, n: o1.n + 6, a: null, b: null }, o1, (v) => {
      o1.a = v;
      o2.b = o0;
      return o0;
    }, 0);
    if (r29 !== null) {
      sum += r29.n;
      if (r29.n % 89 === 29) kept.push(r29);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r30 = h1(o0, new Made("c17." + o0.n, o0.n + 9, o1), { tag: "s18." + o0.n, n: o0.n + 1, a: o0, b: null }, 0);
    if (r30 !== null) {
      sum += r30.n;
      if (r30.n % 41 === 3) kept.push(r30);
    }
  } catch (e) {
    caught.push(e);
  }
  try {
    const r31 = h5(o1, o1, 0);
    if (r31 !== null) {
      sum += r31.n;
      if (r31.n % 89 === 6) kept.push(r31);
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
const watched = [];
function watch(helper, parameter, value) {
  watched.push([helper, parameter, new WeakRef(value)]);
  return value;
}
const answers = new Map();
const answeredBefore = new WeakSet();
function answer(helper, result, handed, heldBefore) {
  let what = "a new object";
  if (result === null) what = "null";
  else if (handed.includes(result)) what = "parameter " + handed.indexOf(result);
  else if (heldBefore.includes(result)) what = "what a parameter holds";
  else if (answeredBefore.has(result)) what = "an object it has answered before";
  if (result !== null) answeredBefore.add(result);
  const name = "h" + helper + " " + what;
  answers.set(name, (answers.get(name) ?? 0) + 1);
}
function ask() {
  for (let r = 0; r < 300; r++) {
    try {
      const w0 = watch(0, 0, { tag: "w", n: r, a: watch(0, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(0, 1, { tag: "w", n: r, a: watch(0, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const w2 = watch(0, 2, { tag: "w", n: r, a: watch(0, 102, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a, w2.a];
      answer(0, h0(w0, w1, w2, 1), [w0, w1, w2], heldBefore);
    } catch {}
    try {
      const w0 = watch(1, 0, { tag: "w", n: r, a: watch(1, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(1, 1, { tag: "w", n: r, a: watch(1, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const w2 = watch(1, 2, { tag: "w", n: r, a: watch(1, 102, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a, w2.a];
      answer(1, h1(w0, w1, w2, 1), [w0, w1, w2], heldBefore);
    } catch {}
    try {
      const w0 = watch(2, 0, { tag: "w", n: r, a: watch(2, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(2, 1, { tag: "w", n: r, a: watch(2, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a];
      answer(2, h2(w0, w1, watch(2, 2, (v) => v), 1), [w0, w1], heldBefore);
    } catch {}
    try {
      const w0 = watch(3, 0, { tag: "w", n: r, a: watch(3, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(3, 1, { tag: "w", n: r, a: watch(3, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a];
      answer(3, h3(w0, w1, watch(3, 2, (v) => v), 1), [w0, w1], heldBefore);
    } catch {}
    try {
      const w0 = watch(4, 0, { tag: "w", n: r, a: watch(4, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(4, 1, { tag: "w", n: r, a: watch(4, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const w2 = watch(4, 2, { tag: "w", n: r, a: watch(4, 102, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a, w2.a];
      answer(4, h4(w0, w1, w2, watch(4, 3, (v) => v), 1), [w0, w1, w2], heldBefore);
    } catch {}
    try {
      const w0 = watch(5, 0, { tag: "w", n: r, a: watch(5, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const w1 = watch(5, 1, { tag: "w", n: r, a: watch(5, 101, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a, w1.a];
      answer(5, h5(w0, w1, 1), [w0, w1], heldBefore);
    } catch {}
    try {
      const w0 = watch(6, 0, { tag: "w", n: r, a: watch(6, 100, { tag: "x", n: r, a: null, b: null }), b: null });
      const heldBefore = [w0.a];
      answer(6, h6(w0, watch(6, 1, (v) => v), 1), [w0], heldBefore);
    } catch {}
  }
}
ask();
await new Promise(resolve => setTimeout(resolve, 1));
churn(90);
await new Promise(resolve => setTimeout(resolve, 1));
churn(90);
const alive = new Map();
for (const [helper, parameter, reference] of watched) {
  if (reference.deref() === undefined) continue;
  const name = "h" + helper + " parameter " + parameter;
  alive.set(name, (alive.get(name) ?? 0) + 1);
}
// One object more or less may be alive for a word that still lies on the stack.
for (const [name, count] of alive) if (count > 1) console.log("KEPT " + name);
for (const [name, count] of answers) console.log("ANSWERED " + name + ": " + count);
