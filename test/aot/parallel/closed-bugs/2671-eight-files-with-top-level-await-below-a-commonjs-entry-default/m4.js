require("./show.cjs");
say("m4 begins");
Object.defineProperty(exports, "first", { enumerable: true, get: () => "m4.first by a getter" });
exports.second = { of: "m4" };
module.exports = class {
  static first = "m4.first of a class";
};
exports.count = 8;
say("m4 ends");
