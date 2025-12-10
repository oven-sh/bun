let stripAnsi: (str: string) => string;

if (typeof Bun !== "undefined" && typeof Bun.stripANSI === "function") {
  stripAnsi = Bun.stripANSI;
} else {
  // Only import npm strip-ansi when not running in Bun
  stripAnsi = require("strip-ansi").default;
}

export default stripAnsi;
