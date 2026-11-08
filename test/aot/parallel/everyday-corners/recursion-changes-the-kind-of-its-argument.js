// Recursion changes the kind of its argument: compiled answers as plain.
function down(x, n) {
  return n === 0 ? x : down(n % 2 ? String(x) : Number(x) + 1, n - 1);
}
console.log(down(1, 5), typeof down(1, 5), down(1, 4), typeof down(1, 4));
