// Taken from Node - lib/internal/util/colors.js
"use strict";

type WriteStream = import("node:tty").WriteStream;

// Computed lazily: never touch `process.stderr` (heavy stream construction) at module load.
let refreshed = false;
const values = {
  blue: "",
  green: "",
  white: "",
  yellow: "",
  red: "",
  gray: "",
  clear: "",
  reset: "",
  hasColors: false,
};

let exports = {
  shouldColorize(stream: WriteStream) {
    if (process.env.FORCE_COLOR !== undefined) {
      return require("internal/tty").getColorDepth(process.env) > 2;
    }

    return stream?.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
  },
  refresh(): void {
    refreshed = true;
    if (exports.shouldColorize(process.stderr)) {
      values.blue = "\u001b[34m";
      values.green = "\u001b[32m";
      values.white = "\u001b[39m";
      values.yellow = "\u001b[33m";
      values.red = "\u001b[31m";
      values.gray = "\u001b[90m";
      values.clear = "\u001bc";
      values.reset = "\u001b[0m";
      values.hasColors = true;
    } else {
      values.blue = "";
      values.green = "";
      values.white = "";
      values.yellow = "";
      values.red = "";
      values.gray = "";
      values.clear = "";
      values.reset = "";
      values.hasColors = false;
    }
  },
};

for (const key of ["blue", "green", "white", "yellow", "red", "gray", "clear", "reset", "hasColors"] as const) {
  Object.defineProperty(exports, key, {
    get() {
      if (!refreshed) exports.refresh();
      return values[key];
    },
    set(value) {
      values[key] = value;
    },
    enumerable: true,
    configurable: true,
  });
}

export default exports;
