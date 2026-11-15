// The rows of a product grow in the loop that stores sums of any number into them.
// STATISTIC: StoresGrowingArrays >= 1
const mk = () => Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i + j)); const a = mk(), b = mk();
function mul(x, y) { const z = []; for (let i = 0; i < 4; i++) { z[i] = []; for (let j = 0; j < 4; j++) { let s = 0; for (let q = 0; q < 4; q++) s += x[i][q] * y[q][j]; z[i][j] = s; } } return z; }
function repeat(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += mul(a, b)[1][2]; }
  return n;
}
console.log(repeat(50), mul(a, b).map(row => row.join()).join("|"));
