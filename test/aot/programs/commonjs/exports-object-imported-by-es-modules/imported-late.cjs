"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let reads = 0;
Object.defineProperty(exports, "counted", {
  enumerable: true,
  get: function () {
    return ++reads;
  },
});
Object.defineProperty(exports, "hidden", { value: "hidden" });
exports.first = 1;
exports.second = 2;
