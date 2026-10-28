// An ES module that is the entry point requires itself: the answer is its namespace object, live, with what is not initialized yet in its dead zone.
export function hoisted() {
  return "hoisted";
}
export const before = 1;
const self = require("./main.mjs");
const attempt = read => {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
};
console.log(typeof self.hoisted, self.before, attempt(() => self.later));
export const later = Number("2");
console.log(self.later, self.hoisted());
