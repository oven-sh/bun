import { isEven } from "./even.mjs";
export function isOdd(n) {
  return n === 0 ? false : isEven(n - 1);
}
