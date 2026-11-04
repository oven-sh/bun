let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function none(odd) { const list = [1, 2, 3]; if (odd) Object.defineProperty(list, 1, descriptor); tick.apply(null, list); }
function one(odd) { const list = [1, 2, 3]; if (odd) Object.defineProperty(list, 1, descriptor); take.apply(null, list); }
for (let i = 0; i < 300; i++) none(i % 2 === 1);
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) one(i % 2 === 1);
console.log(calls, reads, sum);
