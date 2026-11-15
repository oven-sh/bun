// A function that is entered by value alone, out of a function that is entered by value alone.
function inner(n: number): number {
  return n + 100;
}
function middle(n: number): number {
  const chosen = [inner][n % 1];
  return chosen(n) + 1;
}
function outerMost(n: number): number {
  const chosen = [middle][n % 1];
  return chosen(n) + 1;
}
console.log(outerMost(1), [outerMost].map(f => f(2)).join());
