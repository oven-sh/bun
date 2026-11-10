import { test, vi } from "bun:test";

// `bun test` undoes the mocks of a test file first and lets the loads in flight end: both mocks give the files themselves, and the runner waits for the text of the file below too.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
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
