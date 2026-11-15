globalThis.reads = 0;
Object.defineProperty(globalThis, "expect", { configurable: true, get() {
  globalThis.reads++;
  return value => ({ mine: "own:" + value });
} });
