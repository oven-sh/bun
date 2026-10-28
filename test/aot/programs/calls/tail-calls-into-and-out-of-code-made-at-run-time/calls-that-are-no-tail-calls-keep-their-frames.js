// A function of the program and a function made by new Function() call each other where one of the two calls is no tail call: the code made at run time is sloppy, or something is done with the result.
// 3,000 calls deep the answer comes back, ten million deep the stack is full, and afterwards everything works as before. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function intoSloppy(n, sum) {
  if (n <= 0) return sum;
  return sloppy(n - 1, sum + 1);
}
function addsToResult(n, sum) {
  if (n <= 0) return sum;
  return 0 + strict(n - 1, sum + 1);
}
function intoAdding(n, sum) {
  if (n <= 0) return sum;
  return adding(n - 1, sum + 1);
}
Object.assign(globalThis, { intoSloppy, addsToResult, intoAdding });
const sloppy = new Function("n", "sum", "return intoSloppy(n, sum);" + never);
const strict = new Function("n", "sum", '"use strict"; return addsToResult(n, sum);' + never);
const adding = new Function("n", "sum", '"use strict"; return 0 + intoAdding(n, sum);' + never);
for (const start of [intoSloppy, addsToResult, intoAdding]) {
  console.log(start(3000, 0));
  try {
    console.log(start(10000000, 0));
  } catch (error) {
    console.log("throws", error.name);
  }
  console.log(start(3000, 0));
}
