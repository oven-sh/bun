import Read from "./holder.mjs";
const key = ["default"].join("");
export function look() {
  try {
    return String(typeof Read);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
