// Objects are bound to a function that nobody keeps, between the test of a field and a later read of it, in functions that are taken into one another.
// Flags: --aot-validate
const kept = [];
const keptFunctions = [];
let slot = null;
function churn(depth) {
}
class Made {
}
class Holder {
}
const holder = new Holder();
const bag = new Map();
function first(x, y) {
}
function spy(tag, n) {
  return {
    n,
  };
}
function h0(p0, d) {
  try {
  } finally {
  }
  const c4 = p0.n % 2 === 0 ? p0 : c1;
}
function h1(p0, p1, p2, d) {
}
function h4(p0, p1, p2, d) {
  const r20 = h7.apply(null, [{ tag: "s12." + p2.n, n: p2.n + 7, a: p0, b: null }, (v) => {
  }, d]);
  const r21 = d > 0 ? h4(new Made("c14." + p2.n, p2.n + 2, p1), new Made("c15." + p0.n, p0.n + 5, null), p0, d - 1) : null;
}
function h7(p0, f0, d) {
  const g26 = first.bind(null, p0);
  const r27 = h8(new Made("c20." + p0.n, p0.n + 6, null), d);
  try {
    r29 = h8(p0, d);
  } catch (e) {
  }
}
function h8(p0, d) {
  const c30 = p0.n % 2 === 0 ? p0 : p0;
  const g31 = first.bind(null, p0);
}
const caught = [];
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: o0, b: null };
  try {
    const r32 = h1({ tag: "s23." + o1.n, n: o1.n + 9, a: o0, b: null }, new Made("c24." + o0.n, o0.n + 3, o0), { tag: "s25." + o0.n, n: o0.n + 4, a: o2, b: null }, 2);
    const r33 = h4(new Made("c26." + o1.n, o1.n + 5, o0), { tag: "s27." + o1.n, n: o1.n + 2, a: o2, b: null }, { tag: "s28." + o0.n, n: o0.n + 7, a: o1, b: null }, 1);
    const r34 = h0({ tag: "s29." + o0.n, n: o0.n + 9, a: o1, b: null }, 2);
  } catch (e) {
  }
  sum += o0.n + o2.n + (o0.b !== null ? o0.b.n : 0) + (o2.a !== null ? o2.a.n : 0) + (o0 === o2.a ? 1 : 0);
}
console.log(sum, churn(60), kept.length, keptFunctions.length, caught.length);
const probe = { tag: "probe", n: 3, a: null, b: null };
const roots = [slot, holder.held, ...bag.values(), ...kept, ...caught, ...keptFunctions.map(f => f(probe)), probe];
