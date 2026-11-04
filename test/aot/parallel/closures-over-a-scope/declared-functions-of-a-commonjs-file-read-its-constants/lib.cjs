"use strict";
const tell = f => {
  try {
    return f();
  } catch (error) {
    return "throws " + error.name;
  }
};
exports.first = first;
const one_1 = require("./one.cjs");
exports.early = tell(second);
const two_1 = require("./two.cjs");
exports.second = second;
function first() {
  return one_1.n;
}
function second() {
  return one_1.n + two_1.n;
}
