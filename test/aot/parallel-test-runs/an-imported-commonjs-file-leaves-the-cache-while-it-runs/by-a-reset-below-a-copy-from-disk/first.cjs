const { vi } = require("bun:test");
if (!globalThis.first) {
  globalThis.first = 1;
  vi.resetModules();
}
