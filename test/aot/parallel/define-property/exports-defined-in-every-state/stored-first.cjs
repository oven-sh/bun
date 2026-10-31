exports.a = 1;
exports.b = 2;
Object.defineProperty(exports, "a", { value: 10 });
Object.defineProperty(exports, "b", { enumerable: false });
Object.defineProperty(exports, "c", { value: 3 });
try { exports.c = 4; } catch (e) {}
