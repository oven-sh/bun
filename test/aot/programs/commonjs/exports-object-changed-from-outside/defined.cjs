"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.label = undefined;
let reads = 0;
let kept = "kept";
const nameOf = receiver => (receiver === exports ? "the exports object" : "another object");
Object.defineProperty(exports, "live", {
  enumerable: true,
  get: function () {
    return `read ${++reads} for ${nameOf(this)}`;
  },
});
Object.defineProperty(exports, "loose", {
  configurable: true,
  enumerable: true,
  get() {
    return kept;
  },
  set(value) {
    kept = `${value} for ${nameOf(this)}`;
  },
});
Object.defineProperty(exports, "hidden", { value: "hidden", writable: true, configurable: true });
Object.defineProperty(exports, "fixed", { value: "fixed", enumerable: true });
exports.plain = "plain";
exports.read = function read() {
  return [exports.__esModule, exports.label, exports.live, exports.loose, exports.hidden, exports.fixed, exports.plain].join("|");
};
exports.stores = {
  __esModule: () => (exports.__esModule = "stored"),
  live: () => (exports.live = "stored"),
  loose: () => (exports.loose = "stored"),
  hidden: () => (exports.hidden = "stored"),
  fixed: () => (exports.fixed = "stored"),
  plain: () => (exports.plain = "stored"),
};
