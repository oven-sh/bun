const { test, vi } = require("bun:test");
vi.mock("./part.cjs", () => ({ a: "mocked" }));
test("reset while the mock waits", () => {
  vi.resetModules();
  vi.doUnmock("./part.cjs");
  const got = require("./part.cjs").a;
  console.log(`SAID ${got} ${globalThis.bodies} ${got === requiredByThePreload.a}`);
});
