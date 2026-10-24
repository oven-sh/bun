globalThis.gettersLog = [];
Object.defineProperty(exports, "a", { enumerable: true, get() { globalThis.gettersLog.push("a"); return "A"; } });
Object.defineProperty(exports, "b", { enumerable: true, get() { globalThis.gettersLog.push("b"); return { k: 1 }; } });
Object.defineProperty(exports, "c", { enumerable: true, get() { globalThis.gettersLog.push("c"); return 3; } });
