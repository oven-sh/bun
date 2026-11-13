const { test, vi } = require("bun:test");
test("what a require of the mocked file gets", () => {
  vi.doMock("./tax.mjs", async () => {
    if (false) { if (await 0) { function spare() {} } }
    return { rate: "mock" };
  });
  console.log("a", require("./tax.mjs").rate, String(globalThis.ran));
});
