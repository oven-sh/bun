// Under: --aot-check=Validate: the test of the constant array's storage stands in front of the loop, and the branch on it in another block
const L = [3, 1, 2, 0];
function f(v) {
  for (let t = 0; t < 2; t++) { let k = 2; do { v = L[0]; } while (--k >= 0); }
  return v;
}
console.log(f(1));
