"use strict";

let internalTTy;
function lazyInternalTTY() {
  internalTTy ??= require("../tty");
  return internalTTy;
}

var exports = {
  blue: "",
  green: "",
  white: "",
  red: "",
  gray: "",
  clear: "",
  reset: "",
  hasColors: false,
  shouldColorize(stream) {
    if (process.env.FORCE_COLOR !== undefined) {
      return lazyInternalTTY().getColorDepth() > 2;
    }
    return stream?.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
  },
  refresh() {
    if (process.stderr.isTTY) {
      const hasColors = exports.shouldColorize(process.stderr);
      exports.blue = hasColors ? "\u001b[34m" : "";
      exports.green = hasColors ? "\u001b[32m" : "";
      exports.white = hasColors ? "\u001b[39m" : "";
      exports.yellow = hasColors ? "\u001b[33m" : "";
      exports.red = hasColors ? "\u001b[31m" : "";
      exports.gray = hasColors ? "\u001b[90m" : "";
      exports.clear = hasColors ? "\u001bc" : "";
      exports.reset = hasColors ? "\u001b[0m" : "";
      exports.hasColors = hasColors;
    }
  },
};

exports.refresh();

export default exports;
