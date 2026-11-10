const { test, vi } = require("bun:test");
test("the mock that was laid last answers", async () => {
  await import("./lays.mjs");
  console.log("SAID", (await vi.importMock("./lib.json")).a);
});
