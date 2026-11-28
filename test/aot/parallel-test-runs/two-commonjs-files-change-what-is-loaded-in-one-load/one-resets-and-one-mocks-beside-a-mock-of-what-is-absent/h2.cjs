const { vi } = require("bun:test");
console.log("h2");
if (!globalThis.h2) {
  globalThis.h2 = 1;
  vi.doMock("./a.mjs", () => ({ v: "Ma" }));
}
