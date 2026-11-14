import { afterEach, test, vi } from "bun:test";

// As beside it, with the mocked file one statement below the file that is required.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
    return { depth: "mocked" };
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
