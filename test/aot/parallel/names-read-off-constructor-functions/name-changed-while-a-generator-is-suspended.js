function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
globalThis.Counter = Counter;
function* run(count) { for (let i = 0; i < count; i++) { yield Counter.of(i).n; yield Counter.of(i).n; } }
let sum = 0, turn = 0;
for (const n of run(10)) { sum += n; if (++turn === 7) (0, eval)("Counter.of = function (n) { return { n: 1000 + n }; }"); }
console.log(sum);
