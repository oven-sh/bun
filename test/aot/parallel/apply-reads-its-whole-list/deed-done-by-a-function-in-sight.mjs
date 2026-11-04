let calls = 0, reads = 0, sum = 0;
function tick() { calls++; }
function take(first) { calls++; sum += first; }
const descriptor = { get() { reads++; return 1; } };
function disturb(list) { Object.defineProperty(list, 1, descriptor); }
function none() { const list = [1, 2, 3]; disturb(list); tick.apply(null, list); }
function one() { const list = [1, 2, 3]; disturb(list); take.apply(null, list); }
for (let i = 0; i < 300; i++) none();
console.log(calls, reads, sum);
for (let i = 0; i < 300; i++) one();
console.log(calls, reads, sum);
