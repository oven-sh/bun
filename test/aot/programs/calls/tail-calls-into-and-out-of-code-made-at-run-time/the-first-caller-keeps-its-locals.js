// A function with many live locals calls into a chain of tail calls between a function of the program and a function made by new Function(), and goes on with the result.
// The caller is a function of the program or code made at run time. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, sum) {
  if (n <= 0) return sum;
  return made(n - 1, sum + 1);
}
globalThis.back = back;
const made = new Function("n", "sum", '"use strict"; return back(n, sum);' + never);
function caller(a, b, c, d, e, f, g, h) {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const x = a * 2 + i, y = b * 3 + i, z = c * 5 + i, w = d * 7 + i, v = e + f + g + h;
    const r = made(1000 + i, i);
    sum += r + x + y + z + w + v;
    const s = back(1001 + i, i);
    sum += s * (x - y) + (z - w) * v;
  }
  return sum;
}
console.log(caller(1, 2, 3, 4, 5, 6, 7, 8), caller(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5));
const madeCaller = new Function(
  "a", "b", "c", "d",
  '"use strict"; let sum = 0; for (let i = 0; i < 5; i++) { const x = a * 2 + i, y = b * 3 + i; const r = back(1000 + i, i); sum += r + x + y + c + d; } return sum;' + never,
);
console.log(madeCaller(1, 2, 3, 4));
