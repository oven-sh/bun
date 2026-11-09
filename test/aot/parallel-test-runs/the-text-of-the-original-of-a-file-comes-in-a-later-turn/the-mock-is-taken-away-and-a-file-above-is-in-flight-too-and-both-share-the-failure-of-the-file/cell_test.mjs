import { afterEach, test, vi } from "bun:test";

// As beside it, with a body that fails: it requires a file that awaits a call. The body runs once and both calls fail with its error; the file that awaits goes on meanwhile, and nobody runs the body again to find it ended.
test("two calls are left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.constructor.name, error.message.replace(/"[^"]*[\\/]/, '"')),
  );
  import("./above.mjs").then(
    it => console.log("the call for the file above came:", it.roof),
    error => console.log("the call for the file above failed:", error.constructor.name, error.message.replace(/"[^"]*[\\/]/, '"')),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
