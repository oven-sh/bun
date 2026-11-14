// STATISTIC: GeneratorCallsTestedBeforeLoops >= 1
// Generators of these functions also go where nobody sees what is done to them, and the program writes no name of theirs: the function is asked before the loop.
function* range(from, to) { for (let i = from; i <= to; i++) yield i; }
const sinks = [v => v, v => Object.getPrototypeOf(v)];
globalThis.sinks = sinks;
console.log(globalThis.sinks.map(f => typeof f(range(1, 3))).join());
const divisors = n => { const out = []; for (const x of range(1, n)) if (!(n % x)) out.push(x); return out; };
const firstOver = (n, limit) => { for (const x of range(1, n)) if (x * x > limit) return x; return -1; };
for (let k = 0; k < 3; k++) console.log(divisors(60 + k).join(), firstOver(50, 90 * k));
