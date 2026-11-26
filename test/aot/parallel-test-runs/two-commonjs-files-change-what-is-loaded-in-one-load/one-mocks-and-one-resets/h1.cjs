const { vi } = require("bun:test");
console.log("h1");
if (!globalThis.h1) {
  globalThis.h1 = 1;
  vi.doMock("./a.mjs", () => ({ v: "Ma" }));
}
