const { test, vi } = require("bun:test");
test("the mock that was laid last answers", async () => {
  vi.doMock("./lib.json", () => ({ a: "of the test" }));
  console.log("SAID", (await vi.importMock("./lib.json")).a);
});
