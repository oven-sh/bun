import { b } from "./second.js";
export const a = 1;
try {
  console.log("first runs", b === 2 ? "two" : "other");
} catch (error) {
  console.log("first runs", error.constructor.name);
}
