// STATISTIC: ReceivedLeavesDistinguished >= 1
// More than four functions reach the loop that calls one of them. The small ones have arms, and the one that holds a loop is called.
let count = 0;
const isPrime = n => { for (let x = 2; x * x <= n; x++) if (n % x === 0) return false; return n > 1; };
function filter(fn) { return function (data) { return { *[Symbol.iterator]() { let i = 0; for (const value of data) { if (!fn(value, i++)) continue; yield value; } } }; }; }
function keep(fn, list) { const out = []; let i = 0; for (const value of list) if (fn(value, i++)) out.push(value); return out; }
const factors = n => filter(x => !(n % x))(Array.from({ length: n }, (_, i) => i + 1));
const pipelines = [filter(x => x % 100 === 0), filter(x => x % 4 === 0), filter((x, i) => i % 400 === 0), filter(isPrime), filter(x => x < 1000), filter(x => count++ < 3)];
const list = Array.from({ length: 1300 }, (_, i) => i);
for (const each of pipelines) console.log([...each(list)].slice(0, 12).join(), [...each([7, 0.5, -4, 100, "8", null, 400])].map(String).join());
console.log([...pipelines[1](pipelines[0](list))].join(), [...factors(60)].join(), [...factors(97)].join(), [...filter(isPrime)(factors(360))].join(), count);
console.log(keep(x => x > 3, [1, 5, 7]).join(), keep((x, i) => i, [1, 5, 7]).join(), keep(x => !x, [0, 1, ""]).length, keep(x => x === 5, [5]).join(), keep(isPrime, [2, 4, 5]).join(), keep(x => { throw new RangeError("e" + x); }, []).length);
try { keep(x => { throw new RangeError("e" + x); }, [3]); } catch (e) { console.log(e.name, e.message); }
