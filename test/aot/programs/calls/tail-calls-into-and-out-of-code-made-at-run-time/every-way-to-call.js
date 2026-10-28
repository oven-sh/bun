// A function of the program and a function made by new Function() call each other in tail position 60,000 times, for each pair of seven ways to write the call:
// f() , o.f() , o[k]() , f.call() , f.apply() , Reflect.apply() , f(...list). No frame stays behind.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
const key = process.argv.length > 1000 ? "x" : "made";
globalThis.keyOfBack = process.argv.length > 1000 ? "x" : "back";
const holder = { made: null, back: null };
globalThis.holder = holder;
let made = null;
const waysOut = {
  plain: (n, sum) => made(n - 1, sum + 1),
  method: (n, sum) => holder.made(n - 1, sum + 1),
  keyed: (n, sum) => holder[key](n - 1, sum + 1),
  call: (n, sum) => made.call(sum, n - 1, sum + 1),
  apply: (n, sum) => made.apply(sum, [n - 1, sum + 1]),
  reflect: (n, sum) => Reflect.apply(made, sum, [n - 1, sum + 1]),
  spread: (n, sum) => made(...[n - 1, sum + 1]),
};
const waysIn = {
  plain: "back(n, sum)",
  method: "holder.back(n, sum)",
  keyed: "holder[keyOfBack](n, sum)",
  call: "back.call(sum, n, sum)",
  apply: "back.apply(sum, [n, sum])",
  reflect: "Reflect.apply(back, sum, [n, sum])",
  spread: "back(...[n, sum])",
};
for (const [nameOut, out] of Object.entries(waysOut)) {
  function back(n, sum) {
    if (n <= 0) return sum + " " + typeof this;
    return out(n, sum);
  }
  globalThis.back = holder.back = back;
  const line = [];
  for (const [nameIn, call] of Object.entries(waysIn)) {
    made = holder.made = new Function("n", "sum", '"use strict"; return ' + call + ";" + never);
    line.push(nameIn + ": " + back(60000, 0) + " " + made(60000, 1));
  }
  console.log(nameOut, "|", line.join(" | "));
}
