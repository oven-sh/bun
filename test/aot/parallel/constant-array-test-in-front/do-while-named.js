// Under: --aot-check=Validate: the test of the constant array's storage stands in front of the loop, and the branch on it in another block
const table = [7, 5, 6, 4];
function spin(x) {
  for (let round = 0; round < 2; round++) {
    let left = 2;
    do { x = table[0]; } while (--left >= 0);
  }
  return x;
}
console.log(spin(9));
