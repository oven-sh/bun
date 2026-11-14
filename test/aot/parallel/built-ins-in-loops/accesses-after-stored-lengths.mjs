// Under: --aot-harden=proof-checks: a stored length answered reads of length and bounded accesses of the array, and the build stopped
function set(p, g, e) { p.length = g ? 2 : 1; p[0] = e; return p.length; }
const p = [];
for (let i = 0; i < 4; i++) console.log(set(p, i & 1, i), p.join());
function cut(l, n) { l.length = n; if (n > 1) l[n - 1] = -n; let s = 0; for (let i = 0; i < l.length; i++) s += l[i] ?? 100; return s * 10 + l.length; }
for (const n of [3, 0, 1, 2, 5, 4]) console.log(cut([1, 2, 3], n), cut([1.5, 2.5], n), cut(["a"].map(x => x.length), n));
function last(l, e) { l.length = 2; l[1] = e; l[l.length] = e + 1; return l[1] + l.length; }
console.log(last([1, 2, 3], 7), last([], 8), last([0.5], 0.25));
function turns(l, n) { let s = 0; for (let k = 0; k < n; k++) { l.push(k, k + 1); l.length = 1; l[0] = k; s += l.length + l[0]; l.length = 0; } return s; }
console.log(turns([], 50));
function frozen(l) { try { l.length = 1; return l.length; } catch (error) { return error.name + l.length; } }
console.log(frozen(Object.freeze([1, 2])), frozen(Object.seal([1, 2])), frozen([1, 2]));
