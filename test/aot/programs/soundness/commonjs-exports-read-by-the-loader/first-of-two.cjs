globalThis.twoLog = globalThis.twoLog || [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.twoLog.push("a"); return 1; } });
