import { afterEach, test, vi } from "bun:test";

// As beside it, with the file that awaits one statement below the file that is required.
test("the call is left in flight", () => {
  vi.doMock("./between.mjs", () => {
    console.log("the factory of the file between is called");
    return { middle: "mocked" };
  });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.constructor.name, error.message.replace(/"[^"]*[\\/]/, '"')),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
