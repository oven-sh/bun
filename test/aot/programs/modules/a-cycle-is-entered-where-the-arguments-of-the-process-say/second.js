import { a } from "./first.js";
export const b = 2;
try {
  console.log("second runs", a === 1 ? "one" : "other");
} catch (error) {
  console.log("second runs", error.constructor.name);
}
