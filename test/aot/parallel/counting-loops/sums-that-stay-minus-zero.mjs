// A sum that begins at minus zero and adds minus zero stays minus zero, in loops that are unrolled for integers too.
const show = x => (Object.is(x, -0) ? "-0" : String(x));
const out = [];
function run(f) { for (const n of [0, -0]) for (const t of [9, (1 << 20) + 9]) out.push(show(f(t, n))); }
function bound(a, b) { return this.v + a + b; }
const holder = { v: 1 };
const g = bound.bind(holder, 2), h = bound.bind({ v: 2147483647 }, 2147483647);
function ofBound(t, n) { for (let k = 0; k < t; k++) n += g(k & 7); return n; }
function ofWide(t, n) { for (let k = 0; k < t; k++) n += h(k & 7); return n; }
run(ofBound); holder.v = 1.5; run(ofBound); holder.v = -2147483648; run(ofBound); holder.v = 2147483648; run(ofBound); run(ofWide);
function once(f) { let d = false, v; return (...a) => { if (!d) { d = true; v = f(...a); } return v; }; }
const first = once(x => x + 1), negated = once(x => x * -1), half = once(x => x + 0.5);
function ofOnce(t, n) { for (let k = 0; k < t; k++) n += first(k); return n; }
function ofNegated(t, n) { for (let k = 0; k < t; k++) n += negated(k); return n; }
function ofHalf(t, n) { for (let k = 0; k < t; k++) n += half(k); return n; }
run(ofOnce); run(ofNegated); run(ofHalf);
console.log(out.join("\n"));
