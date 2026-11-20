function Counter(n) { this.n = n; }
Counter.of = function (n) { return new Counter(n + 1); };
globalThis.Counter = Counter;
function run(count) {
  let before = 0, after = 0;
  for (let i = 0; i < count; i++) {
    if (i === 5) (0, eval)("Counter.of = function (n) { return { n: 1000 + n }; }");
    if (i < 5) before += Counter.of(i).n; else after += Counter.of(i).n;
  }
  return before + " " + after;
}
console.log(run(10));
