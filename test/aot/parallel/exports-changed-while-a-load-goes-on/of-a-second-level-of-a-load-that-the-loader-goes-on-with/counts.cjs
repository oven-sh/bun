let reads = 0;
Object.defineProperty(exports, "count", { enumerable: true, get() { return ++reads; } });
