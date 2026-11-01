globalThis.reads = [];
Object.defineProperty(require("node:url"), "__esModule", { get() { globalThis.reads.push("url"); return true; } });
Object.defineProperty(require("node:os"), "__esModule", { get() { globalThis.reads.push("os"); return false; } });
