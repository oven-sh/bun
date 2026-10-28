import { value } from "./barrel.js";
import { other } from "./others.js";
try {
  console.log("reader runs", value === 1 ? "one" : "other");
} catch (error) {
  console.log("reader runs", error.constructor.name);
}
console.log(other === 2 ? "two" : "not two");
export function read() {
  return [value, other];
}
