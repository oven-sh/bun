// Taken from Node - lib/internal/util/colors.js
"use strict";

/** Any stream is taken: only a terminal has the two members. */
type Terminal = { isTTY?: boolean; getColorDepth?: $Node.TTYWriteStream["getColorDepth"] } | null | undefined;

let exports = {
  blue: "",
  green: "",
  white: "",
  red: "",
  hasColors: false,
  shouldColorize(stream: object | null | undefined) {
    if (process.env.FORCE_COLOR !== undefined) {
      return require("internal/tty").getColorDepth(process.env) > 2;
    }

    return (
      (stream as Terminal)?.isTTY &&
      (typeof (stream as Terminal)!.getColorDepth === "function" ? (stream as Terminal)!.getColorDepth!() > 2 : true)
    );
  },
  refresh(): void {
    if (exports.shouldColorize(process.stderr)) {
      exports.blue = "\u001b[34m";
      exports.green = "\u001b[32m";
      exports.white = "\u001b[39m";
      exports.red = "\u001b[31m";
      exports.hasColors = true;
    } else {
      exports.blue = "";
      exports.green = "";
      exports.white = "";
      exports.red = "";
      exports.hasColors = false;
    }
  },
};

exports.refresh();

export default exports;
