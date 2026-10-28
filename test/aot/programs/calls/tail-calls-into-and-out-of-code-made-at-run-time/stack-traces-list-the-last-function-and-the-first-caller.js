// An error is made at the end of a chain of tail calls between a function of the program and a function made by new Function().
// Its stack lists the function that made it and the caller of the chain, and none of the functions that have left by a tail call. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function names(error) {
  return error.stack
    .split("\n")
    .slice(1, 7)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*$/, ""))
    .join(" < ");
}
function back(n) {
  if (n <= 0) return names(new Error("x"));
  return made(n - 1);
}
Object.assign(globalThis, { back, names });
const made = new Function("n", '"use strict"; if (n === -1) return names(new Error("y")); return back(n);' + never);
function first(n) {
  return "" + back(n);
}
function second(n) {
  return "" + made(n);
}
const third = new Function("n", '"use strict"; return "" + back(n);' + never);
for (const n of [0, 1, 5]) console.log(first(n));
for (const n of [0, 5, -1]) console.log(second(n));
for (const n of [0, 1, 6]) console.log(third(n));
