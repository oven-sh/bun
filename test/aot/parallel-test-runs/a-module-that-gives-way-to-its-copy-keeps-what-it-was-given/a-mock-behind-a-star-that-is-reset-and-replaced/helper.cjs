const { vi } = require("bun:test");
console.log("helper");
if (!globalThis.helper) {
  globalThis.helper = 1;
  vi.resetModules();
  vi.doMock("./p.mjs", () => {
    globalThis.f2 = (globalThis.f2 ?? 0) + 1;
    console.log("factory 2");
    const v = "M2" + globalThis.f2;
    return { v, default: v, platform: v };
  });
}
