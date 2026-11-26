const { mock } = require("bun:test");
if (!globalThis.before) {
  globalThis.before = 1;
  mock.module("./p.json", () => {
    globalThis.f1 = (globalThis.f1 ?? 0) + 1;
    console.log("factory 1");
    const v = "M1" + globalThis.f1;
    return { v, default: v, platform: v };
  });
}
