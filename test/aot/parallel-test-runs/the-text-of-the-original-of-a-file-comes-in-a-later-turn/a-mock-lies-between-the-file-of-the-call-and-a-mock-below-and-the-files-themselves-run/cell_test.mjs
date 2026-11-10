import { test, vi } from "bun:test";

// The mock between gives the file itself, so the load goes on through it to the mock below, which does so too.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
    return new Promise(() => {});
  });
  vi.doMock("./middle.mjs", () => {
    console.log("the factory of the file between is called");
    return { middle: "mocked" };
  });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    it => console.log("the call came:", it.opening, it.mocked),
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
