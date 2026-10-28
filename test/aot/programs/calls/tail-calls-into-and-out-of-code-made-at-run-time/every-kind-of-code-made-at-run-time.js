// A function of the program calls code made at run time, and that code calls it back, in tail position 100,000 times. The code is a function from new Function(),
// from a direct and from an indirect eval(), a static method, an arrow function and a method of an object literal. No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
let made = null;
function back(n, sum, mark) {
  if (n <= 0) return sum + mark;
  return made(n - 1, sum + 1, mark);
}
globalThis.back = back;
const kinds = {
  "new Function": () => new Function("n", "sum", "mark", '"use strict"; return back(n, sum, mark);' + never),
  "direct eval": () => eval("(function (n, sum, mark) { return back(n, sum, mark); })" + never),
  "indirect eval": () => (0, eval)('"use strict"; (function (n, sum, mark) { return back(n, sum, mark); })' + never),
  "static method": () => (0, eval)("(class { static made(n, sum, mark) { return back(n, sum, mark); } })" + never).made,
  "arrow function": () => (0, eval)('"use strict"; ((n, sum, mark) => back(n, sum, mark))' + never),
  "method": () => (0, eval)('"use strict"; ({ made(n, sum, mark) { return back(n, sum, mark); } })' + never).made,
};
for (const [name, make] of Object.entries(kinds)) {
  made = make();
  console.log(name + ":", back(100000, 0, "a"), made(100000, 0, "b"));
}
