const { test, vi } = require("bun:test");
test("what was handed out as the original stays the original", async () => {
  const required = require("./lib.cjs");
  const first = await vi.importActual("./lib.cjs");
  vi.doUnmock("./lib.cjs");
  vi.doMock("./lib.cjs", () => ({ a: "second" }));
  const mocked = require("./lib.cjs");
  const second = await vi.importActual("./lib.cjs");
  console.log("SAID", required.a, first.a, mocked.a, second.a);
});
