// Numbers that a closure captures, read in loops: before the maker has run, in loops without iterations, stored between loops, in loops that store them, undefined and fractions.
const show = x => (Object.is(x, -0) ? "-0" : String(x));
const out = [];
function sum(turns) { let n = 0; for (let k = 0; k < turns; k++) n += o.get(); return n; }
function early(turns) { let n = 0; for (let k = 0; k < turns; k++) n += late.get(); return n; }
out.push(early(0));
try { out.push(early(3)); } catch (error) { out.push(error.constructor.name); }
function make() { let c = 1; return { get: () => c, inc: () => { c++; }, set: v => { c = v; } }; }
const o = make();
out.push(sum(0), sum(1), sum(1000)); o.inc(); out.push(sum(10));
for (const v of [0.5, -0, 2147483648, NaN, 2 ** 53, -7]) { o.set(v); out.push(show(sum(0)), show(sum(1)), show(sum(9)), show(sum(100))); }
function moved(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += o.get(); if (k % 5 === 4) o.inc(); } return n; }
o.set(3); out.push(moved(23), sum(4));
const late = (() => { let c; return { get: () => c, set: v => { c = v; } }; })();
out.push(show(early(2))); late.set(5); out.push(early(6)); late.set(undefined); out.push(show(early(1)));
function memo(f) { let last, has = false; return x => { if (!has) { has = true; last = f(x); } return last; }; }
const m = memo(x => x * 2 + 1);
function cached(turns) { let n = 0; for (let k = 3; k < turns; k++) n += m(k); return n; }
out.push(cached(0), cached(3), cached(50), cached(4));
function greatest(list) { let best = -1; for (let i = 0; i < list.length; i++) if (list[i] > o.get()) best = i; return best; }
o.set(2.5); out.push(greatest([]), greatest([1, 2, 3, 2]), greatest([9, 1]));
console.log(out.join(" "));
