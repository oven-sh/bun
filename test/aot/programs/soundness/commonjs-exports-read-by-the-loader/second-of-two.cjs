globalThis.twoLog = globalThis.twoLog || [];
Object.defineProperty(exports, "b", { enumerable: true, get() { globalThis.twoLog.push("b"); return 1; } });
