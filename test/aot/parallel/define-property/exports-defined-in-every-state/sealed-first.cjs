exports.a = 1;
Object.seal(exports);
Object.defineProperty(exports, "late", { get() { return 1; } });
