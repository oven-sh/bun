var reads = 0;
exports.taken = "must not replace what is there";
exports.default = "a default is not passed on";
exports.changing = 1;
exports.change = function () {
  exports.changing = "changed";
};
Object.defineProperty(exports, "counted", {
  enumerable: true,
  get: function () {
    return ++reads;
  },
});
Object.defineProperty(exports, "hidden", { value: "not enumerable", enumerable: false });
Object.defineProperty(exports, "fixed", { value: "fixed", enumerable: true, writable: false, configurable: false });
