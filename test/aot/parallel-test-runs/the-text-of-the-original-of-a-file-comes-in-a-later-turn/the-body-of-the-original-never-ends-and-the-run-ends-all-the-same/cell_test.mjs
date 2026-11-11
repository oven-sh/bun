import { afterEach, test, vi } from "bun:test";

// Where the tests of a file are done the runner waits for the text of the original that the call in flight still loads, not for its body. The interval keeps the loop alive.
test("the call is left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.name),
  );
  console.log("the test ends");
});
afterEach(async () => {
  for (let job = 0; job < 6; job++) await null;
  vi.doUnmock("./part.mjs");
  console.log("the mock is taken away");
});
