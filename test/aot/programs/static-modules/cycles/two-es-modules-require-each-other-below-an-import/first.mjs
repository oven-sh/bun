export function hoisted() {
  return "hoisted";
}
const second = require("./second.mjs");
export const name = "first";
export const fromSecond = second.saw;
