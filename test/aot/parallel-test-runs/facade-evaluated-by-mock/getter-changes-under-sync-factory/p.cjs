globalThis.runs = (globalThis.runs || 0) + 1;
let kept = 1;
Object.defineProperty(exports, "a", { enumerable: true, configurable: true, get() { return kept; }, set(value) { kept = value; } });
