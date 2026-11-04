import * as all from "./holder.mjs";
const key = ["default"].join("");
export function look() {
  try {
    return String(Object.keys({ ...all }).length);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
