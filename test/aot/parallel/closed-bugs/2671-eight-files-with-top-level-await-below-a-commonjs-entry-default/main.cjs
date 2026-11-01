// Flags: --aot-validate
require("./show.cjs");
say("m0 begins");
require("./m1.ts");
exports.first = function first() {
  return "m0";
};
module.exports = { first: "m0.first replaced", count: 1 };
exports.second = { of: "m0" };
exports.__esModule = true;
say("m0 ends");
setTimeout(async () => {
  for (const late of globalThis.atTheEnd.splice(0)) await late();
  say("the end");
}, 1);
