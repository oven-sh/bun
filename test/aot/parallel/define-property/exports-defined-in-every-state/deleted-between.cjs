Object.defineProperty(exports, "a", { value: 1, configurable: true });
exports.b = 2;
delete exports.a;
Object.defineProperty(exports, "a", { value: 3, configurable: true });
Object.defineProperty(exports, "c", { value: 4, enumerable: true });
