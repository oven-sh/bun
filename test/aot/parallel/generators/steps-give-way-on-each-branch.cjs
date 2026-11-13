// Steps whose branches lead to the yield, past it, and to the end of the generator, from both sides of each comparison.
function show(v) { return Object.is(v, -0) ? "-0" : String(v); }
function clamp(v, least, most) { return Math.min(most, Math.max(least, v)); }
function* range(from, to, by) {
  let step = clamp(from < to ? (by > 0 ? by : -by) : by > 0 ? -by : by, -9, 9), first = clamp(from, -99, 99), last = clamp(to, -99, 99);
  for (let i = first; first < last ? i <= last : i >= last; i += step) yield i;
}
function* odd(n, m) { let a = n * 1, b = m / 1; for (let i = 0; i < 12; i++) { a = a + b; if (a > 40) { yield a; } else if (a < -3) yield -a; b = b - 0.5; } return "end"; }
function* both(n, m) { let x = n / 2, y = m / 2; while (x !== y) { if (x < y) x = x + 1; else x = x - 1; yield x; if (x === 4.5) return; } }
function* counted(it) { let i = 0, n = 0; for (const x of it) { if (x === 3) { i++; continue; } n--; yield x + i++ * 100 + n; } return i + ":" + n; }
const makes = [
  () => range(1, 6, 1), () => range(6, 1, 1), () => range(0, 2, 0.5), () => range(2, 0, -0.5), () => range(1, NaN, 1), () => range(3, 3, 1), () => range(0, 3, NaN), () => range(-0, 2, 1), () => range(0, 1e9, 33),
  () => odd(0, 1), () => odd(38, 2), () => odd(NaN, 1), () => odd(-3, 0.25), () => both(1, 8), () => both(10, 2), () => both(5, 5), () => both(1, 20), () => counted(range(1, 6, 1)), () => counted([3, 3, 4]), () => counted(new Set([1, 3, 2])), () => counted(counted(range(5, 1, 1))),
];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < makes.length; i++) {
    const out = [];
    for (const v of makes[i]()) { out.push(show(v)); if (out.length === 9) break; }
    const byHand = makes[i](), answers = [];
    for (let k = 0; k < 5; k++) { const r = k === 3 ? byHand.next(7) : byHand.next(); answers.push(show(r.value) + (r.done ? "." : "")); }
    const left = byHand.return(8), spread = [...makes[i]()].length > 60 ? "many" : [...makes[i]()].map(show).join();
    const thrown = makes[i](); let caught = ""; thrown.next(); try { thrown.throw(new RangeError("x")); } catch (e) { caught = e.name; }
    console.log(round, i, out.join(), "|", answers.join(), show(left.value), left.done, spread, caught, show(thrown.next().done));
  }
}
