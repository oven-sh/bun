// The helper reads p1.n, calls the closure it was handed, and reads p1.n again. The closure stores into the very object, and into another
// that is now and then an object with a getter. Once helper and closure are inlined into the loop, the store stands between the first
// read's guard and the second read.
const bag = new Map();
function spy(tag, n) {
  return {
    tag,
    n,
    b: null,
    get a() {
      return null;
    },
  };
}
function helper(p0, p1, f0) {
  const found = bag.get(p1.n % 5) ?? null;
  const answered = f0(p1);
  try {
    if (p1.n % 37 === 0) throw p0;
  } finally {
  }
  return { tag: "s" + p0.n, n: p0.n + 5, a: p1, b: found ?? answered ?? null };
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  const o1 = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };
  const o2 = { tag: "o2." + i, n: i + 5, a: null, b: null };
  try {
    const r = helper(o1, o2, v => {
      o1.b = v;
      o2.b = null;
    });
    sum += r.n;
  } catch (e) {
    sum += e.n * 1000;
  }
}
console.log(sum);
