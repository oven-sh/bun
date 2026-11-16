"use strict";
Object.defineProperty(exports, "light", {
  enumerable: true,
  get: function () {
    console.log("light is read");
    return 2;
  },
});
Object.defineProperty(exports, "heavy", {
  enumerable: true,
  get: function () {
    return require("./heavy.cjs");
  },
});
exports.plain = 3;
