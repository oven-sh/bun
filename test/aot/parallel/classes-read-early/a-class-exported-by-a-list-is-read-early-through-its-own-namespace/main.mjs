// The module reads its own namespace in front of the statement of the class.
import * as self from "./main.mjs";
const key = ["C"].join("");
function look() {
  try {
    return typeof self[key];
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("early:", look());
console.log("side effect in front of the class");
class C {
  run() {
    return 1;
  }
}
export { C };
console.log("behind:", look());
