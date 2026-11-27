import { afterEach, test, vi } from "bun:test";

// `bun test` undoes every mock of a test file first and lets the loads in flight end. The body of the file requires a mocked file: no factory is called, and the require() gets the file at once.
test("the call is left in flight", () => {
  vi.doMock("./between.mjs", () => {
    console.log("the factory of the file between is called");
    return { middle: "mocked" };
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
