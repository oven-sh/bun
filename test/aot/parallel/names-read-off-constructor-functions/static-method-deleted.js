function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
globalThis.Counter = Counter;
function run(count) {
  let total = 0, thrown = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("delete Counter.of");
    try { total += Counter.of(i).n; } catch (error) { thrown += error instanceof TypeError ? 1 : 100; }
  }
  return total + " " + thrown;
}
console.log(run(10));
