// A function of the program and a function made by new Function() call each other in tail position 100,000 times. The number of arguments changes from call to call,
// from two to twenty-one, and is more or less than the number of parameters on either side. Each side adds up what it was given. No frame stays behind and no argument is lost. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, a, b, c, d, e, f, g, h, i, j, k) {
  const sum = (a + (b | 0) + (c | 0) + (d | 0) + (e | 0) + (f | 0) + (g | 0) + (h | 0) + (i | 0) + (j | 0) + (k | 0)) % 1000003;
  if (n <= 0) return sum;
  if (n % 3 === 0) return made(n - 1, sum);
  if (n % 3 === 1) return made(n - 1, sum, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20);
  return made(n - 1, sum, n, 3, 4, 5);
}
globalThis.back = back;
const made = new Function(
  "n", "a", "b", "c", "d", "e", "f", "g", "h",
  '"use strict"; const sum = (a + (b | 0) + (c | 0) + (d | 0) + (e | 0) + (f | 0) + (g | 0) + (h | 0)) % 1000003;' +
    " if (n % 2) return back(n, sum, b, c, d, e, f, g, h); if (n % 5 === 0) return back(n, sum); return back(n, sum, n, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17);" + never,
);
for (const n of [100000, 100001, 100002, 100003, 100004, 100005]) console.log(back(n, 0), made(n, 0));
