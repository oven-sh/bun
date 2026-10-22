"use strict";
const { kValue, kCount, kNext } = require("./keys.cjs");
function Thing(value) {
  this[kValue] = value;
  this[kCount] = 0;
  this[kNext] = null;
}
Thing.prototype.touch = function () {
  this[kCount]++;
  return this[kValue];
};
Thing.prototype.count = function () {
  return this[kCount];
};
Thing.prototype.link = function (next) {
  this[kNext] = next;
  return this;
};
Thing.prototype.length = function () {
  let length = 0;
  for (let thing = this; thing !== null; thing = thing[kNext]) length++;
  return length;
};
module.exports = Thing;
