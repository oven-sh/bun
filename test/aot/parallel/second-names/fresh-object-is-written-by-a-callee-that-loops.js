// The loop that stores stands in a callee, small or large, called directly, by value, as a method or through call and apply.
function small(o, n) { for (let i = 0; i < n; i++) o.n += i; }
function smallWithSecondName(o, n) { let k = o; for (let i = 0; i < n; i++) { k.n += i; k = k; } }
function large(o, n) { let k = o; for (let i = 0; i < n; i++) { k.n += i; if (k.n > 1e9) { console.log(1); console.log(2); console.log(3); console.log(4); console.log(5); console.log(6); console.log(7); console.log(8); console.log(9); console.log(10); console.log(11); console.log(12); } k = k; } return k; }
function handsBack(o) { return o; }
function bySmall(n) { const acc = { n: 0 }; small(acc, n); return acc.n; }
function bySecondName(n) { const acc = { n: 0 }; smallWithSecondName(acc, n); return acc.n; }
function byLarge(n) { const acc = { n: 0 }; large(acc, n); return acc.n; }
function byResult(n) { const acc = { n: 0 }; const back = large(acc, n); back.n += 100; return acc.n; }
function byHandedBack(n) { const acc = { n: 0 }; let k = handsBack(acc); for (let i = 0; i < n; i++) { k.n += i; k = handsBack(k); } return acc.n; }
function byCall(n) { const acc = { n: 0 }; smallWithSecondName.call(null, acc, n); return acc.n; }
function byApply(n) { const acc = { n: 0 }; smallWithSecondName.apply(null, [acc, n]); return acc.n; }
function byThis(n) { const acc = { n: 0, add(count) { let k = this; for (let i = 0; i < count; i++) { k.n += i; k = k; } } }; acc.add(n); return acc.n; }
function byClosure(n) { const acc = { n: 0 }; const run = () => { let k = acc; for (let i = 0; i < n; i++) { k.n += i; k = k; } }; run(); return acc.n; }
function byCallback(n) { const acc = { n: 0 }; let k = acc; [1, 2, 3].forEach(v => { k.n += v * n; k = k; }); return acc.n; }
function byReduce(n) { const acc = { n: 0 }; [1, 2, 3].reduce((k, v) => { k.n += v * n; return k; }, acc); return acc.n; }
console.log(bySmall(0), bySmall(6), bySecondName(6), byLarge(6), byResult(6), byHandedBack(6), byCall(6), byApply(6), byThis(6), byClosure(6), byCallback(2), byReduce(2));
let last = ""; for (let r = 0; r < 300; r++) last = [bySmall(6), bySecondName(6), byLarge(6), byResult(6), byHandedBack(6), byCall(6), byApply(6), byThis(6), byClosure(6), byCallback(2), byReduce(2)].join(" ");
console.log(last);
