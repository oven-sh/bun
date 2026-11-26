const { vi } = require("bun:test");
console.log("helper");
if (!globalThis.h) {
  globalThis.h = 1;
  vi.doMock("./p.json", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
}
