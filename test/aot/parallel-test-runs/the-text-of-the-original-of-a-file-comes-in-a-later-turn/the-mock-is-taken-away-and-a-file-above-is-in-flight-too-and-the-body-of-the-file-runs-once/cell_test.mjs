import { afterEach, test, vi } from "bun:test";

// The mock of the first call is taken away behind the test, and a second call in flight leads to the same file by a statement. There is one entry under the key of the file: its body runs once, and both calls get it, the first call first.
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
