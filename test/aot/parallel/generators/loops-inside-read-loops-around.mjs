// What the loop around makes, read in the loop inside: the yield reads it as the way to it made it, whichever way that is.
const show = v => Object.is(v, -0) ? "-0" : typeof v === "number" ? "" + v : typeof v + ":" + String(v);
const log = [];
function* branches(n) { let s = 0.5, t = 0.25; for (let i = 0; i < n; i++) { yield s + t; const v = s; s = s + 0.5; if (s > 2.5) { t = v; s = 0.5; } } return s * 10 + t; }
function* outer() { for (let i = 0.5; i < 2.5; i += 0.5) { let j = 0.5; while (true) { yield i; j += 0.5; if (j >= 2.5) break; } } }
function* outerIntegers(n) { for (let i = 0; i < n; i++) { let j = 0.5; while (true) { yield i; j += 0.5; if (j >= 1.5) break; } } }
function* outerMade(n) { for (let i = 0.5; i < n; i += 0.5) { const v = i * 2; let j = 0.5; while (true) { yield v; j += 0.5; if (j >= 1.5) break; } } return "end"; }
function* leftOut(n) { let s = 0.5, w = 0.25; while (true) { yield s; s = s + 0.5; if (s > n) { w = s * 2; s = w - n; if (w > 40) return w; } } }
function* manyOuter(n) { for (let i = 0.5; i < n; i += 0.5) { const v = i - 0.25; let j = 0.5; while (true) { yield v; j += 0.5; if (j >= 2.5) break; } } return "end"; }
function* sums(n) { let s = 0.5; for (let i = 0; i < n; i++) { s += 1.5; let j = 0.5; while (true) { yield s; j += 0.5; if (j >= 1.5) break; } } return s; }
function* innermost(n) { for (let i = 0.5; i < n; i += 0.5) { let j = 0.5; while (true) { yield j + i; j += 0.5; if (j >= i + 1) break; } } }
function drive(g, sends) { const s = []; let k = 0, x; while (k < 18) { x = g.next(sends[k++ % sends.length]); s.push(show(x.value)); if (x.done) break; } if (!x.done) s.push(show(g.return(7).value)); return s.join(); }
function over(g) { const s = []; for (const x of g) { s.push(show(x)); if (s.length > 14) break; } return s.join(); }
function* pulled(g) { let k = 0; for (const x of g) { yield x; if (++k > 10) return k; } }
const G = { branches, outer, outerIntegers, outerMade, leftOut, manyOuter, sums, innermost };
globalThis.G = G;
for (const k of Object.keys(G)) for (const a of [[0.5, 1], [1, -0.5], [3, 2], [2.5, 0.25], [-0, -0], [4, NaN]]) console.log(k, a.join(), drive(G[k](...a), [1, 0.5, 2]), drive(G[k](...a), [1, -1, 3, "t"]), over(G[k](...a)), [...pulled(G[k](...a))].join());
console.log(log.length);
