// Division by minus one at the border: compiled answers as plain.
function d(a, b) {
  return (a / b) | 0;
}
for (const [a, b] of [
  [-2147483648, -1],
  [2147483647, -1],
  [7, 2],
  [-7, 2],
  [1, 0],
  [0, 0],
])
  console.log(d(a, b));
