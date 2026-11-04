import { inner } from "./middle.mjs";
const key = ["C"].join("");
export function look() {
  try {
    return String(typeof inner.C);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
