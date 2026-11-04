import { C as Read } from "./holder.mjs";
const key = ["C"].join("");
export function look() {
  try {
    return String(typeof Read);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
