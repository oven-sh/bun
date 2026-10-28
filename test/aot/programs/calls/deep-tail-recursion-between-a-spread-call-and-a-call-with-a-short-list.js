// Two methods with a rest parameter call each other in tail position a million times: one spreads its rest array, so it calls the other by value; the other passes two values, which become
// the rest array of the first. Wherever that array lies, no frame stays behind for it. The output is that of plain Bun.
const table = {
  even(n, ...rest) {
    if (n === -1) return String(rest[0]) + n + "0";
    if (n === -2) return String(rest[1]) + n + "1";
    return n === 0 ? "even " + rest.length + rest[0] : table.odd(n - 1, ...rest);
  },
  odd(n, ...rest) {
    return n === 0 ? "odd " + rest.length + rest[1] : table.even(n - 1, rest[0], rest[1]);
  },
};
const names = ["even", "odd"];
console.log(table[names[0]](1000000, "a", "b"));
