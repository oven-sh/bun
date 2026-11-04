import * as second from "./second.mjs";
export function look() {
  try {
    return typeof second.Shown;
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("at the end:", look());
