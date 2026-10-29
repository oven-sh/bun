// A function expression that is called where it is written keeps itself and is called again while another body runs: what it requires then sees that module half done and holds its first object.
(function again() {
  globalThis.again = again;
  if (globalThis.second) globalThis.b = require("./b.cjs");
})();
globalThis.second = true;
const a = require("./a.cjs");
console.log(a.x, globalThis.b.late());
