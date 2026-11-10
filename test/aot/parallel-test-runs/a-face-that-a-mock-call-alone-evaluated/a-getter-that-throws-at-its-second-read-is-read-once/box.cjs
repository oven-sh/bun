let reads = 0;
Object.defineProperty(exports, "a", { enumerable: true, configurable: true, get() { if (++reads === 2) throw new Error("second"); return reads; } });
exports.reads = () => reads;
