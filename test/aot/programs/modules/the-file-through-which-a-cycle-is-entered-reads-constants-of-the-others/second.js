import { a } from "./first.js";
export const b = 2;
export function late() {
  return a ? "a is set" : "a is not set";
}
try {
  console.log("second runs", a);
} catch (error) {
  console.log("second runs", error.constructor.name);
}
