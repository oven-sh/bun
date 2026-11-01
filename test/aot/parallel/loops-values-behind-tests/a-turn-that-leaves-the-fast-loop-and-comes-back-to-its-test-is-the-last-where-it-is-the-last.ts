// A loop that counts down over a view has a fast form. The first call of fill() goes an unlikely way inside it, which counts down for itself and comes back to the fast form's own test.
// The test read the count of the likely way, so the loop took one more turn at position -1. The build checks its proofs at run time, which stops at that position.
// Flags: --aot-testing=CheckProofsAtRunTime
function sumFromTheEnd(view: Int16Array): number {
  let sum = 0;
  for (let i = view.length - 1; i >= 0; i--) {
    if (Number.isInteger(view[i])) view.fill(3, i, i + 1);
    sum += view[i];
  }
  return sum;
}
function sumOfEveryThirdFromTheEnd(view: Int32Array): number {
  let sum = 0;
  for (let i = view.length - 1; i >= 0; i -= 3) {
    if (Number.isInteger(view[i])) view.fill(5, i, i + 1);
    sum += view[i];
  }
  return sum;
}
const one = sumFromTheEnd(new Int16Array([1]));
const three = sumOfEveryThirdFromTheEnd(new Int32Array([1, 2, 3]));
console.log(one, three);
