// An argument that is made of a quotient through constants, next to one that is made of the same constants without one.
function halves(n: number, left: number, right: number): string {
  if (n === 0) return left + " " + right;
  const whole = n + 1;
  const twice = whole + whole;
  const half = twice / 4;
  const both = twice + half;
  return halves(n - 1, left + both, right + twice);
}
console.log(halves(3, 0, 0), halves(4, 0.5, 1));
