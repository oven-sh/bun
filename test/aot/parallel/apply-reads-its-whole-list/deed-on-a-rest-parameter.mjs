let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function none(...rest) { Object.defineProperty(rest, 1, descriptor); tick.apply(null, rest); }
function one(...rest) { Object.defineProperty(rest, 1, descriptor); take.apply(null, rest); }
for (let i = 0; i < 300; i++) none(1, 2, 3);
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) one(1, 2, 3);
console.log(calls, reads, sum);
