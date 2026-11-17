function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
globalThis.Counter = Counter;
async function run(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) { sum += Counter.of(i).n; await null; sum += Counter.of(i).n; }
  return sum;
}
const answer = run(10);
await null; await null; await null; await null; await null;
(0, eval)("Counter.of = function (n) { return { n: 1000 + n }; }");
console.log(await answer);
