const { mock } = require("bun:test");
console.log("helper");
if (!globalThis.h) {
  globalThis.h = 1;
  mock.module("./p.json", async () => {
    console.log("factory");
    await 0;
    return { v: "M", default: "M", platform: "M" };
  });
}
