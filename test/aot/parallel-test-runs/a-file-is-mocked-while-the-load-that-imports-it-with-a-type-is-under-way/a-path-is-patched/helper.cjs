const { mock } = require("bun:test");
console.log("helper");
if (!globalThis.h) {
  globalThis.h = 1;
  mock.module("./p.bin", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
}
