import { early } from "./b.mjs";
export function sumOfTable(n, from) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= from) sum += table[i & 3];
  }
  return sum;
}
export const table = new Int32Array([1, 2, 3, 4]);
export const seen = early;
