import { test, vi } from "bun:test";

// The runner waits for texts and never for bodies: not for the body of the file below either, which runs for the mock that gives the file itself.
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
