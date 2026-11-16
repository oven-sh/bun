import { afterEach, test, vi } from "bun:test";

// The load in flight has come to the file below while the tests ran, and its factory has been called. Where the tests of the file are done the runner does not wait for that factory.
const called = new Promise(done => (globalThis.wasCalled = done));
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
    globalThis.wasCalled();
    return new Promise(() => {});
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
test("the factory below is called meanwhile", async () => {
  await called;
  console.log("the factory has been called");
});
