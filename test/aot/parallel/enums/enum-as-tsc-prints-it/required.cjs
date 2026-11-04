"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Level = void 0;
exports.pick = pick;
var Level;
(function (Level) {
  Level[(Level["Low"] = 0)] = "Low";
  Level[(Level["High"] = 1)] = "High";
})(Level || (exports.Level = Level = {}));
function pick(value) {
  switch (value) {
    case Level.Low:
      return "low";
    case Level.High:
      return "high";
    default:
      return "none";
  }
}
