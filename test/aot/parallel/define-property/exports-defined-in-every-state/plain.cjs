Object.defineProperty(exports, "__esModule", { value: true });
exports.a = 1;
Object.defineProperty(exports, "g", { enumerable: true, get: function () { return exports.a + 1; } });
Object.defineProperty(exports, "h", { value: 3, writable: true, configurable: true });
Object.defineProperty(exports, "s", { set(v) { exports.a = v; }, configurable: true });
Object.defineProperty(exports, "gs", { get() { return "gs"; }, set(v) {}, enumerable: true, configurable: true });
