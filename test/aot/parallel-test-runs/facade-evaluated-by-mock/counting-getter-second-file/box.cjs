let reads = 0;
Object.defineProperty(exports, "a", { enumerable: true, configurable: true, get() { return ++reads; } });
exports.reads = () => reads;
