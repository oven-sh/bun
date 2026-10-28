// A function of the program makes a new function with new Function() and calls it in tail position, and that function calls the first one back in tail position, 60,000 times.
// Another function made at run time has been used as a constructor and has properties of its own. No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function step(n, sum) {
  if (n <= 0) return "done " + sum;
  const made = new Function("n", "sum", '"use strict"; return step(n - 1, sum + 1);' + never);
  return made(n, sum);
}
globalThis.step = step;
console.log(step(60000, 0));

function back(n, sum) {
  if (n <= 0) return "done " + sum;
  return constructor(n - 1, sum + 1);
}
globalThis.back = back;
const constructor = new Function("n", "sum", '"use strict"; return back(n, sum);' + never);
constructor.prototype.mark = 1;
new constructor(0, 0);
console.log(constructor.name, constructor.length, Object.keys(constructor.prototype).join());
console.log(back(150000, 0));
