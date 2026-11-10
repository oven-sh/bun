import { afterEach, test, vi } from "bun:test";

// `bun test` undoes the mocks of a test file first and lets the loads in flight end: the factory of a mock below such a load is not called either.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", async original => {
    console.log("the factory of the file below is called");
    return { ...(await original()), depth: "patched" };
  });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
