let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
const shared = [1, 2, 3];
function none() { tick.apply(null, shared); }
function one() { take.apply(null, shared); }
for (let i = 0; i < 300; i++) { none(); one(); }
console.log(calls, reads, sum);
Object.defineProperty(shared, 1, descriptor);
for (let i = 0; i < 300; i++) { none(); one(); }
console.log(calls, reads, sum);
