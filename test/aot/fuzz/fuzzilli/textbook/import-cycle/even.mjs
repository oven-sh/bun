import { isOdd } from "./odd.mjs";
export function isEven(n) {
  return n === 0 ? true : isOdd(n - 1);
}
