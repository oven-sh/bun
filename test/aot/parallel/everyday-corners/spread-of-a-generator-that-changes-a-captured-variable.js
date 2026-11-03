// Spread of a generator that changes a captured variable: compiled answers as plain.
let n = 0;
function* g() {
  while (n < 3) yield n++;
}
console.log(
  [...g(), ...g()].join(),
  n,
  Math.max(
    ...(function* () {
      yield 1;
      yield 5;
    })(),
  ),
);
