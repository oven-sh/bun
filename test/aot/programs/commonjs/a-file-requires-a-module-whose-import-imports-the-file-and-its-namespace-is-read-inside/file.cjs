console.log("the file begins");
exports.Made = class Made {
  answer() {
    return 42;
  }
};
exports.text = "text";
exports.nothing = undefined;
require("./second.mjs");
exports.late = "late";
console.log("the file ends");
