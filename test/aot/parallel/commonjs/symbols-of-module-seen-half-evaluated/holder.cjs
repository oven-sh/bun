"use strict";
let { kFirst, kSecond } = require("./symbols.cjs");
exports.sawAtStart = typeof kFirst + " " + typeof kSecond;
function Holder(first, second) {
  this.plain = 0;
  this[kFirst] = first;
  this[kSecond] = second;
}
exports.make = (first, second) => new Holder(first, second);
exports.read = holder => holder[kFirst] + " " + holder[kSecond] + " " + holder.undefined + " " + (kFirst in holder);
exports.look = () => {
  ({ kFirst, kSecond } = require("./symbols.cjs"));
};
