// while, do while, break, continue, a labeled break and a return from inside: every way out of the loop finds the stores.
function whileWithBreak(n) { const acc = { n: 0 }; let k = acc, i = 0; while (true) { if (i >= n) break; k.n += i; i++; k = k; } return acc.n; }
function breakBehindStore(n) { const acc = { n: 0 }; let k = acc, i = 0; while (true) { k.n += i; if (i >= n) break; i++; k = k; } return acc.n; }
function doWhile(n) { const acc = { n: 0 }; let k = acc, i = 0; do { k.n += i; i++; k = k; } while (i < n); return acc.n; }
function withContinue(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { if (i & 1) continue; k.n += i; k = k; } return acc.n; }
function labeled(n) { const acc = { n: 0 }; let k = acc; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { k.n += 1; if (j === 2) break outer; k = k; } } return acc.n; }
function returned(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; ; i++) { k.n += i; if (i >= n) return acc.n; k = k; } }
function thrown(n) { const acc = { n: 0 }; let k = acc; try { for (let i = 0; ; i++) { k.n += i; if (i >= n) throw 0; k = k; } } catch { return acc.n; } }
function forOf(list) { const acc = { n: 0 }; let k = acc; for (const v of list) { k.n += v; k = k; } return acc.n; }
function forIn(object) { const acc = { n: "" }; let k = acc; for (const key in object) { k.n += key; k = k; } return acc.n; }
console.log(whileWithBreak(0), whileWithBreak(6), breakBehindStore(0), breakBehindStore(6), doWhile(0), doWhile(6), withContinue(6), labeled(5), returned(6), thrown(6), forOf([1, 2, 3]), forIn({ a: 1, b: 2 }));
let last = ""; for (let r = 0; r < 300; r++) last = [whileWithBreak(6), breakBehindStore(6), doWhile(6), withContinue(6), labeled(5), returned(6), thrown(6), forOf([1, 2, 3]), forIn({ a: 1, b: 2 })].join(" ");
console.log(last);
