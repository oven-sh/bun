require("./show.cjs");
say("m2 begins");
exports.first = "m2.first";
exports.second = { of: "m2" };
exports.default = "m2.default";
globalThis.atTheEnd.push(async () => {
  try {
    const m3_0 = await import("./m3.ts");
    tell("m2 late import m3", () => m3_0);
    tell("m2 late import m3.default", () => m3_0.default);
  } catch (error) {
    say("m2 late import m3 throws", error && error.name);
  }
});
module.exports = { first: "m2.first replaced", count: 1 };
say("m2 ends");
