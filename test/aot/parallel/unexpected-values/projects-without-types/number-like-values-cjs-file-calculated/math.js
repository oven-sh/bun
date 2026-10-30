export const twice = n => n * 2;
export const plusOne = n => n + 1;
export const minusOne = n => n - 1;
export const negated = n => -n;
export const bits = n => n | 0;
export const shifted = n => n >>> 1;
export function incremented(n) {
  n++;
  return n;
}
export const isLess = n => n < 4;
export const looselyThree = n => n == 3;
export const strictlyThree = n => n === 3;
export const element = n => [10, 20, 30, 40][n];
export function sumBelow(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}
export const squared = n => n ** 2;
export const remainder = n => n % 2;
export const floored = n => Math.floor(n);
export const inText = n => `${n}`;
