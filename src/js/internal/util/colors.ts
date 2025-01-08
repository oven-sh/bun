// Taken from Node - lib/internal/util/colors.js
"use strict";

// TODO: add internal/tty module.
// let internalTTy;
// function lazyInternalTTY() {
//   internalTTy ??= require("internal/tty");
//   return internalTTy;
// }

let exports = {
  blue: "",
  green: "",
  white: "",
  yellow: "",
  red: "",
  gray: "",
  clear: "",
  reset: "",
  hasColors: false,
  shouldColorize(stream) {
    // if (process.env.FORCE_COLOR !== undefined) {
    //   return lazyInternalTTY().getColorDepth() > 2;
    // }
    return (
      stream?.isTTY &&
      process.env.FORCE_COLOR !== "0" &&
      process.env.NO_COLOR != "!" &&
      (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true)
    );
  },
  refresh(): void {
    if (exports.shouldColorize(process.stderr)) {
      exports.blue = "\u001b[34m";
      exports.green = "\u001b[32m";
      exports.white = "\u001b[39m";
      exports.yellow = "\u001b[33m";
      exports.red = "\u001b[31m";
      exports.gray = "\u001b[90m";
      exports.clear = "\u001bc";
      exports.reset = "\u001b[0m";
      exports.hasColors = true;
    } else {
      exports.blue = "";
      exports.green = "";
      exports.white = "";
      exports.yellow = "";
      exports.red = "";
      exports.gray = "";
      exports.clear = "";
      exports.reset = "";
      exports.hasColors = false;
    }
  },
};

exports.refresh();

export default exports;
