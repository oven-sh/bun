const { vi } = require("bun:test");
if (!globalThis.before) {
  globalThis.before = 1;
  vi.doMock("./p.mjs", () => {
    globalThis.f1 = (globalThis.f1 ?? 0) + 1;
    console.log("factory 1");
    const v = "M1" + globalThis.f1;
    return { v, default: v, platform: v };
  });
}
