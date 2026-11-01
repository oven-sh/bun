console.log("first starts");
export function hoisted() {
  return "hoisted";
}
const second = require("./second.cjs");
export const late = "late";
export const seen = second.seen + ", then " + second.read("late");
console.log("first ends");
