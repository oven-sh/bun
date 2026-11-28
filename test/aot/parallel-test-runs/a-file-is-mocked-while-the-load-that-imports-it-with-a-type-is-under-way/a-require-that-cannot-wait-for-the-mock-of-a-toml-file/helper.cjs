const { vi } = require("bun:test");
console.log("helper");
if (!globalThis.h) {
  globalThis.h = 1;
  vi.doMock("./p.toml", async () => {
    console.log("factory");
    await 0;
    return { v: "M", default: "M", platform: "M" };
  });
}
