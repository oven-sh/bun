// One of two asynchronous functions is called and awaited in each turn.
// STATISTIC: CallsDispatchedByCallee >= 1
async function slow(x: number) { await null; return x + 1; } async function quick(x: number) { return x * 2; }
let sum = 0;
for (let i = 0; i < 200; i++) { const f = i & 1 ? slow : quick; sum += await f(i); }
console.log(sum);
