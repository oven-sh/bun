"use strict";
const outside = require("./stored_from_outside.js");
exports.store = function () {
  outside.x = 3;
  return outside.x;
};
exports.add = function () {
  outside.fresh = 4;
  return outside.fresh;
};
