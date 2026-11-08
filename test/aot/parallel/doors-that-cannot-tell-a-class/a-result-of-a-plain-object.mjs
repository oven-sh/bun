const unseen = (0, eval)("(i) => (() => 5)");
function pick(i) { let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0; return i % 3 === 0 ? Object.create(null) : unseen(i + w - 1); }
function take(x) { let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0; return (x === undefined ? 0 : typeof x === "function" ? 100 : 7) + w - 1; }
let sum = 0;
for (let i = 0; i < 300; i++) sum += take(pick(i));
console.log(sum);
