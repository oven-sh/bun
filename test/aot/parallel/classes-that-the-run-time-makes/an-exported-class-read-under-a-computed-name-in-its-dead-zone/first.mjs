import * as second from "./second.mjs";
const parts = ["Sho", "wn"];
export function look() {
  try {
    return typeof second[["Sho", "wn"].join("")];
  } catch (error) {
    return error.constructor.name;
  }
}
export function reflect() {
  try {
    return typeof Reflect.get(second, "Sho" + "wn".toString());
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("at the end:", look(), reflect(), parts.length);
