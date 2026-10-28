// Four functions made by new Function() call each other in tail position 150,000 times, each time through a helper of the program that makes the call in tail position too,
// with as many, with more or with fewer arguments than the callee has parameters. No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function helper(next, n, sum) {
  return next(n, sum);
}
function helperWithMore(next, n, sum) {
  return next(n, sum, 1, 2, 3, 4, 5, 6, 7);
}
function helperWithFewer(next, n, sum) {
  globalThis.parked = sum;
  return next(n);
}
Object.assign(globalThis, { helper, helperWithMore, helperWithFewer, parked: 0 });
globalThis.ping = new Function("n", "sum", '"use strict"; if (n <= 0) return "ping " + sum; return helper(pong, n - 1, sum + 1);' + never);
globalThis.pong = new Function("n", "sum", '"use strict"; if (n <= 0) return "pong " + sum; return helperWithMore(pang, n - 1, sum + 1);' + never);
globalThis.pang = new Function("n", "sum", "a", "b", '"use strict"; if (n <= 0) return "pang " + sum + a + b; return helperWithFewer(pung, n - 1, sum + 1);' + never);
globalThis.pung = new Function("n", "sum", '"use strict"; if (n <= 0) return "pung " + parked + sum; return helper(ping, n - 1, parked + 1);' + never);
for (const n of [150000, 150001, 150002, 150003]) console.log(ping(n, 0));
