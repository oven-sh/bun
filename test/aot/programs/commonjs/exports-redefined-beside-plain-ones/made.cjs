Object.defineProperty(exports, "__esModule", { value: true });
exports.c = exports.b = exports.a = void 0;
exports.a = 1;
exports.b = 10;
Object.defineProperty(exports, "b", { enumerable: true, get() { return exports.a + 1; } });
exports.c = 3;
Object.defineProperty(exports, "d", { value: 4, writable: false });
exports.e = "five";
Object.defineProperty(exports, "a", { enumerable: false });
exports.f = [6];
exports.bump = function () {
  exports.a += 10;
  exports.c += 10;
  exports.e += "!";
  return exports;
};
