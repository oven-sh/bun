var reads = 0;
Object.defineProperty(exports, "counted", {
  enumerable: true,
  get: function () {
    return ++reads;
  },
});
