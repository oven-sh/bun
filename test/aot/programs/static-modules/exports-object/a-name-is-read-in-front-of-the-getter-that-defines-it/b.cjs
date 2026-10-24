const m = require("./m.cjs");
console.log(early());
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(early());
function early() {
  return exports.x;
}
