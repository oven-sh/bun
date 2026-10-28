// A function of the program and a function made by new Function() call each other in tail position 100,000 times, through a Proxy without an apply trap on one side or on both.
// The program also calls apply() by name. No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
let out = null;
function back(n, sum) {
  if (n <= 0) return sum + " " + typeof this;
  return out(n, sum);
}
globalThis.back = back;
globalThis.proxyOfBack = new Proxy(back, {});
const waysOut = {
  plain: (n, sum) => made(n - 1, sum + 1),
  apply: (n, sum) => made.apply(sum, [n - 1, sum + 1]),
  proxy: (n, sum) => proxyOfMade(n - 1, sum + 1),
};
let made = null;
let proxyOfMade = null;
for (const call of ["back(n, sum)", "proxyOfBack(n, sum)", "proxyOfBack.call(sum, n, sum)"]) {
  made = new Function("n", "sum", '"use strict"; return ' + call + ";" + never);
  proxyOfMade = new Proxy(made, {});
  const line = [];
  for (const name of Object.keys(waysOut)) {
    out = waysOut[name];
    line.push(name + ": " + back(100000, 0) + " " + made(100000, 1));
  }
  console.log(call, "|", line.join(" | "));
}
