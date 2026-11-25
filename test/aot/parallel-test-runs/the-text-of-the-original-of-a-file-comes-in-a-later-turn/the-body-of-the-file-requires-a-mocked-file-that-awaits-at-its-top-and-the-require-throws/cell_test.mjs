import { afterEach, test, vi } from "bun:test";

// The mock is undone where the tests are done and the require() gets the file itself, which awaits at its top: its body begins, and the require() throws as it does of every such file.
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
