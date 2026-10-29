// A function of the program and a function made by new Function() call each other in tail position 300,000 times, started from either side.
// No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, sum) {
  if (n <= 0) return "stopped at " + sum;
  return made(n - 1, sum + 1);
}
globalThis.back = back;
const made = new Function("n", "sum", '"use strict";\nreturn back(n, sum);' + never);
console.log(back(300000, 0));
console.log(made(300000, 0));
