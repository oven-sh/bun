// A function of the program and a function made by new Function() call each other in tail position 150,000 times and hand on new objects, while the collector runs now and then.
// Every object that is handed on arrives. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, list) {
  if (n <= 0) return list.length + " " + list[0].n + " " + list[list.length - 1].n;
  if (n % 20000 === 0) Bun.gc(true);
  return made(n - 1, n % 1000 === 0 ? [...list, { n }] : list, { n }, [n]);
}
globalThis.back = back;
const made = new Function("n", "list", "a", "b", '"use strict"; if (a.n !== n + 1 || b[0] !== n + 1) throw new Error("lost"); return back(n, list);' + never);
console.log(back(150000, [{ n: -1 }]));
