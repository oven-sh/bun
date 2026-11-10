// STATISTIC: IteratorAllocationsElidedInSteps >= 1
const m = new Map([["a", 1], ["bc", 2]]);
function f(n) { let s = 0; for (let i = 0; i < n; i++) { const [k] = m.keys(); s += k.length + m.values().next().value; } return s; }
console.log(f(8), f(0));
