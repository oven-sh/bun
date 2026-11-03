// Mutual recursion swaps arguments: compiled answers as plain.
function even(a, b, n) {
  return n === 0 ? [a, b] : odd(b, a, n - 1);
}
function odd(a, b, n) {
  return n === 0 ? [a, b] : even(b, a + 1, n - 1);
}
console.log(JSON.stringify(even(1, undefined, 5)), JSON.stringify(even("x", null, 4)));
