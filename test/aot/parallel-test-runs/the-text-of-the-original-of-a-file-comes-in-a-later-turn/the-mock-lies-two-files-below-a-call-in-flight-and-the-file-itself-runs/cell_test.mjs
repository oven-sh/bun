import { afterAll, test, vi } from "bun:test";

// `bun test` undoes the mocks of a test file before it goes on to the next one. The load in flight then finds the file itself, and the factory of the mock below it is not called.
// The call is made in the last hook of the file, so that no file is read between the call and the end: the end of this file always comes first.
test("the test ends in front of the call", () => {
  console.log("the test ends");
});
afterAll(() => {
  vi.doMock("./below.mjs", async original => {
    console.log("the factory of the file below is called");
    return { ...(await original()), depth: "patched" };
  });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  globalThis.call = import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.message),
  );
});
afterAll(() => {
  vi.doUnmock("./part.mjs");
});
