import { C as Read } from "./middle.mjs";
const key = ["C"].join("");
export function look() {
  try {
    return String(typeof Read);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
