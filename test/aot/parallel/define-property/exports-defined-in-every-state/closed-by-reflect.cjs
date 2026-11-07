exports.a = 1;
Object.preventExtensions(exports);
exports.a = [Reflect.defineProperty(exports, "late", { value: 1, enumerable: true }), Reflect.defineProperty(exports, "a", { value: 2 })].join();
