const { test, vi } = require("bun:test");
vi.mock("./part.cjs", () => ({ a: "mocked", say: () => "mocked" }));
test("t", () => {
  console.log("SAID the preload holds", requiredByThePreload.a, requiredByThePreload.say());
  const mocked = require("./part.cjs");
  console.log("SAID the test gets", mocked.a, mocked.say(), mocked === requiredByThePreload);
});
