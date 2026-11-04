import * as all from "./middle.mjs";
const key = ["C"].join("");
export function look() {
  try {
    return String(typeof all.inner.C);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
