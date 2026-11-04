import * as all from "./holder.mjs";
const key = ["default"].join("");
export function look() {
  try {
    return String(typeof Reflect.get(all, key));
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look(), key.length);
