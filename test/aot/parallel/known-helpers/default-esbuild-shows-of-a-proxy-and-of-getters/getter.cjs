let reads = 0;
Object.defineProperty(exports, "__esModule", { get() { reads++; globalThis.markerReads = reads; return reads > 100; } });
exports.a = 1;
