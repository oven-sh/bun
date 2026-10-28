import { a } from "./first.js";
await Promise.resolve();
console.log("second goes on");
await new Promise(resolve => setTimeout(resolve, 1));
export const b = 2;
export function late() {
  return a;
}
