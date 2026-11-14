// Under: --aot-check=Validate: the test of the constant array's storage stands in front of the loop, and the branch on it in another block
const L: number[] = [3, 1, 2, 0];
function f(a: number): number {
  let v = a | 0;
  for (let t = 0; t < 2; t++) { let k = 2; do { v = L[v & 3]; } while (--k >= 0); }
  console.log(v);
  return 0;
}
f(1); f(6);
