function Counter(n) { this.n = n; }
Counter.of = function (n) { if (n === 5) throw new Error("five"); return new Counter(n + 1); };
globalThis.Counter = Counter;
function run(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    try { sum += Counter.of(i).n; } catch (e) { (0, eval)("Counter.of = function (n) { return { n: 1000 + n }; }"); sum += Counter.of(i).n; } finally { sum += Counter.of(0).n; }
  }
  return sum;
}
console.log(run(10));
