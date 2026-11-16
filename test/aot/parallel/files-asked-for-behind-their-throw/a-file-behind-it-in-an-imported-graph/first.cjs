"use strict";
missing(eval("exports.count"));
class Counter {
  step() {
    return (module.exports.count *= 2);
  }
}
exports.Counter = Counter;
