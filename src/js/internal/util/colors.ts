// Taken from Node - lib/internal/util/colors.js
"use strict";

type WriteStream = import("node:tty").WriteStream;
type GetColorDepth = (this: import("node:tty").WriteStream, env?: NodeJS.ProcessEnv) => number;

let getColorDepth: undefined | GetColorDepth;
const lazyGetColorDepth = (): GetColorDepth =>
  (getColorDepth ??= require("node:tty").WriteStream.prototype.getColorDepth);

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
  shouldColorize(stream: WriteStream) {
    if (stream?.isTTY) {
      const depth = lazyGetColorDepth().$call(stream);
      console.error("stream is a tty with color depth", depth);
      return depth > 2;
    }

    // do not cache these since users may update them as the process runs
    const { NO_COLOR, NODE_DISABLE_COLORS, FORCE_COLOR } = process.env;
    return NO_COLOR === undefined && NODE_DISABLE_COLORS === undefined && FORCE_COLOR !== "0";
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
