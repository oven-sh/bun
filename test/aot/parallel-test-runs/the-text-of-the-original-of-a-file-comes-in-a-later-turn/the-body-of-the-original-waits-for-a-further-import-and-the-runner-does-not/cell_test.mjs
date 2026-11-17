import { afterEach, test, vi } from "bun:test";

// The body has begun when it asks for another file: the runner waits no longer.
test("the call is left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
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
