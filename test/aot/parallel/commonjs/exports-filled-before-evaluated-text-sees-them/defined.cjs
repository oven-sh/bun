Object.defineProperty(exports, "fixed", { value: 1 });
exports.early = 1;
exports.fixed = 2;
Object.defineProperty(exports, "loose", { value: 1, configurable: true });
exports.other = 2;
Object.defineProperty(exports, "loose", { value: 2, enumerable: true, writable: true });
exports.late = 3;
exports.loose = 4;
try {
  Object.defineProperty(exports, "fixed", { value: 5 });
} catch (error) {
  console.log(error instanceof TypeError);
}
exports.last = 6;
