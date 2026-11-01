// Modulo sign: compiled answers as plain.
function m(a, b) {
  const r = a % b;
  return Object.is(r, -0) ? "-0" : String(r);
}
for (const [a, b] of [
  [-4, 2],
  [4, -2],
  [-5, 3],
  [5, -3],
  [0, 5],
  [-0, 5],
  [5, 0],
  [2147483647, -1],
  [-2147483648, -1],
])
  console.log(m(a, b));
