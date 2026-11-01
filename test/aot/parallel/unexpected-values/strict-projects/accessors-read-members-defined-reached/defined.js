var reads = 0;
var stored = [];
Object.defineProperty(exports, "counted", {
  enumerable: true,
  get: function () {
    return ++reads;
  },
});
Object.defineProperty(exports, "kept", {
  enumerable: true,
  get: function () {
    return stored.length;
  },
  set: function (value) {
    stored.push(value);
  },
});
Object.defineProperty(exports, "fixed", { enumerable: true, value: 7, writable: false });
Object.defineProperty(exports, "hidden", { enumerable: false, value: 8, writable: true });
exports.plain = 9;
exports.stored = stored;
