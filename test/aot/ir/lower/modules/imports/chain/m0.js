"use strict";
exports.c = 1;
exports.f = function (x) {
  return x + exports.c;
};
class K {
  constructor() {
    this.v = 0;
  }
}
exports.K = K;
