// Short functions that return by calls of themselves and of each other: every length around the copies, deep ones, accumulators of all kinds, stores, throws and their messages, three in a ring.
const out = [];
const even = x => (x === 0 ? true : odd(x - 1)), odd = x => (x === 0 ? false : even(x - 1));
function count(x, n) { return x === 0 ? n : count(x - 1, n + x); }
function halves(x, n) { if (x < 1) return n; return halves(x / 2, n + 1); }
let stored = 0;
function store(x) { stored += x; return x > 0 ? store(x - 1) : stored; }
function throws(x, n) { if (x === 3) throw new RangeError("three behind " + n); return throws(x - 1, n + 1); }
function a(x, n) { return x === 0 ? "a" + n : b(x - 1, n * 2); }
function b(x, n) { return x === 0 ? "b" + n : c(x - 1, n + 1); }
function c(x, n) { return x === 0 ? "c" + n : a(x - 1, -n); }
class Walker { constructor() { this.steps = 0; } down(x) { this.steps++; return x === 0 ? this : this.down(x - 1); } }
for (let x = 0; x < 20; x++) out.push(even(x), odd(x), count(x, 0.5), halves(x, 0), a(x, 1), store(x), new Walker().down(x).steps);
for (let x = 3; x < 14; x++) { try { throws(x, 0); } catch (error) { out.push(error.message); } }
out.push(even(100001), odd(100001), count(100000, 0), halves(1e300, 0), count(5, "t"), count(0), b(9, 0.25));
let n = 0; for (let k = 0; k < 1000; k++) n += even(20 + (k & 7)) ? count(k & 15, 1) : -1; out.push(n);
console.log(out.join(" "));
