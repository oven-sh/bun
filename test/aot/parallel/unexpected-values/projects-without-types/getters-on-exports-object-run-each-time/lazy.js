var reads = [];
exports.reads = reads;
var turn = 0;
Object.defineProperty(exports, "list", {
  enumerable: true,
  get: function () {
    reads.push("list");
    turn++;
    return turn % 3 === 0 ? "a text" : turn % 3 === 1 ? [turn] : { length: "long" };
  },
});
Object.defineProperty(exports, "once", {
  enumerable: true,
  configurable: true,
  get: function () {
    reads.push("once");
    Object.defineProperty(exports, "once", { value: [1, 2, 3], enumerable: true });
    return "the first answer";
  },
});
Object.defineProperty(exports, "helper", {
  enumerable: false,
  get: function () {
    reads.push("helper");
    return function () {
      return this === exports;
    };
  },
});
Object.defineProperty(exports, "fixed", { value: 1, writable: false, enumerable: true });
Object.defineProperty(exports, "throwing", {
  enumerable: true,
  get: function () {
    reads.push("throwing");
    throw new RangeError("not ready");
  },
});
