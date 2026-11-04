import { second as other } from "./cycle-b.mjs";
console.log("cycle-a runs");
export default function first() {
  return "first sees " + other();
}
export const name = "a";
export { other as second };
