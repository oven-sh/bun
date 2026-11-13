const { test, vi } = require("bun:test");
test("what a require of the mocked file gets", () => {
  vi.doMock("./tax.mjs", async () => {
    if (globalThis.never) { return 1; { function spare() {} await 0; } }
    return { rate: "mock" };
  });
  console.log("a", require("./tax.mjs").rate, String(globalThis.ran));
});
