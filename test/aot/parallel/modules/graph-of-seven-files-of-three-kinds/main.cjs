// Seven files, CommonJS, modules and TypeScript, that import and require each other in rings.
require("./show.cjs");
say("m0 begins");
globalThis.atTheEnd.push(() => tell("m0 late require m1", () => require("./m1.mjs")));
globalThis.atTheEnd.push(() => tell("m0 late require m1.second", () => require("./m1.mjs").second));
module.exports = { first: "m0.first replaced", count: 1 };
exports.first = "m0.first";
globalThis.atTheEnd.push(async () => {
  try {
    const m3_2 = await import("./m3.ts");
    tell("m0 late import m3", () => m3_2);
    tell("m0 late import m3.default", () => m3_2.default);
  } catch (error) {
    say("m0 late import m3 throws", error && error.name);
  }
});
module.exports.second = 2;
exports.default = "m0.default";
let m5_1;
try {
  m5_1 = require("./m5.cjs");
  tell("m0 early m5", () => m5_1);
} catch (error) {
  say("m0 requires m5 throws", error && error.name);
}
globalThis.atTheEnd.push(() => tell("m0 late m5", () => m5_1));
globalThis.atTheEnd.push(async () => {
  try {
    const m0_3 = await import("./main.cjs");
    tell("m0 late import m0", () => m0_3);
    tell("m0 late import m0.default", () => m0_3.default);
  } catch (error) {
    say("m0 late import m0 throws", error && error.name);
  }
});
say("m0 ends");
setTimeout(async () => {
  for (const late of globalThis.atTheEnd.splice(0)) await late();
  say("the end");
}, 1);
