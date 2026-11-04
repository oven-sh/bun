// Operands are converted in order: compiled answers as plain.
const log = [];
const v = (n, x) => ({
  valueOf() {
    log.push(n);
    return x;
  },
});
console.log(
  v("a", 1) + v("b", 2),
  v("c", 1) < v("d", 2),
  v("e", 2) > v("f", 1),
  v("g", 2) ** v("h", 3),
  `${v("i", 1)}`.length,
  log.join(),
);
