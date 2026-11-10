"use strict";
const a = require("./m0");
exports.c = a.c + 1;
exports.f = function (x) {
  return x & 1 ? a.f(x) + exports.c : exports.c;
};
class K {
  constructor() {
    this.v = 1;
  }
}
exports.K = K;
