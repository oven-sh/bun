// Three way rotation with early exit: compiled answers as plain.
function spin(a, b, c, n) {
  while (n-- > 0) {
    if (a === c) return "met " + n;
    const t = a;
    a = b;
    b = c;
    c = t;
    if (typeof b === "number") b++;
  }
  return [a, b, c].join();
}
for (const [a, b, c] of [
  [1, 2, 3],
  [undefined, 1, null],
  ["x", 1, "x"],
  [0, 0, 1],
])
  console.log(spin(a, b, c, 5));
