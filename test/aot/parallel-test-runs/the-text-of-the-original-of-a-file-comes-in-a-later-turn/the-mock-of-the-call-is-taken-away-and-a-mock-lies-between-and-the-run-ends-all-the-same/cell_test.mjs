import { afterEach, test, vi } from "bun:test";

// Whether the load in flight comes to the file between in front of the undo of the mocks or behind it is a race under `bun test`, so nothing here says which of the two it got.
// Either way it does not come to the factory below, which never settles: the call comes and the run ends.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => new Promise(() => {}));
  vi.doMock("./middle.mjs", () => ({ middle: "mocked" }));
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.mocked),
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
