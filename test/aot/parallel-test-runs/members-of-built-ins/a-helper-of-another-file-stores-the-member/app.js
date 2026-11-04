export function product(a, b) {
  return Math.imul(a, b);
}
export function products(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.imul(i, 2);
  return sum;
}
