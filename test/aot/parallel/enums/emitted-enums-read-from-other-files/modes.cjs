"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mode = void 0;
exports.modeInside = modeInside;
var Mode;
(function (Mode) {
  Mode["On"] = "on";
  Mode["Off"] = "off";
})(Mode || (exports.Mode = Mode = {}));
function modeInside() {
  return Mode.On + "/" + Mode.Off;
}
