// Chains of 100,000 tail calls between a function of the program and a function made by new Function() are started by map(), JSON.stringify(), sort(), a getter, a promise job, a microtask and a timer.
// No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, sum) {
  if (n <= 0) return sum;
  return made(n - 1, sum + 1);
}
globalThis.back = back;
const made = new Function("n", "sum", '"use strict"; return back(n, sum);' + never);
console.log([100000, 100001].map(back).join(), [100000, 100001].map(made).join());
console.log(JSON.stringify({ a: 100000 }, (key, value) => (typeof value === "number" ? back(value, 0) : value)));
console.log([3, 1, 2].sort((a, b) => made(50000, a) - back(50000, b)).join());
const getters = {
  get program() {
    return back(100000, 1);
  },
  get made() {
    return made(100000, 2);
  },
};
console.log(getters.program, getters.made);
Promise.resolve(100000)
  .then(n => back(n, 3))
  .then(console.log);
queueMicrotask(() => console.log(made(100000, 4)));
setTimeout((n, sum) => console.log(made(n, sum)), 0, 100000, 5);
