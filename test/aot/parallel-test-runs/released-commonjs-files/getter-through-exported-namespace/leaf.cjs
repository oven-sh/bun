globalThis.runs = (globalThis.runs ?? 0) + 1;
const own = globalThis.runs;
Object.defineProperty(exports, "word", { enumerable: true, get: () => "leaf " + own });
