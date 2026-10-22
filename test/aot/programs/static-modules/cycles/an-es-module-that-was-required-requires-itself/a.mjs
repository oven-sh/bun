export function hoisted() {
  return "hoisted";
}
export const before = 1;
const self = require("./a.mjs");
export const seen = [typeof self.hoisted, self.before, Object.keys(self).length].join();
export const seenLater = () => [typeof self.hoisted, self.before, Object.keys(self).length].join();
export const requiredLater = () => typeof require("./a.mjs").hoisted;
