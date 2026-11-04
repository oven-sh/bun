// The second name goes round the outer loop, the inner loop, or both.
function roundInner(n) { const acc = { n: 0 }; for (let i = 0; i < n; i++) { let k = acc; for (let j = 0; j < n; j++) { k.n += j; k = k; } } return acc.n; }
function roundOuter(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) k.n += j; k = k; } return acc.n; }
function roundBoth(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { let m = k; for (let j = 0; j < n; j++) { m.n += j; m = m; } k = m; } return acc.n; }
function readBetween(n) { const acc = { n: 0 }; let k = acc; let seen = ""; for (let i = 0; i < n; i++) { for (let j = 0; j < 2; j++) { k.n += 1; k = k; } seen += acc.n + ","; } return seen; }
function madeInOuter(n) { let sum = 0; for (let i = 0; i < n; i++) { const acc = { n: i }; let k = acc; for (let j = 0; j < n; j++) { k.n += j; k = k; } sum += acc.n; } return sum; }
console.log(roundInner(0), roundInner(4), roundOuter(4), roundBoth(4), readBetween(3), madeInOuter(4));
let last = ""; for (let r = 0; r < 300; r++) last = [roundInner(4), roundOuter(4), roundBoth(4), readBetween(3), madeInOuter(4)].join(" ");
console.log(last);
