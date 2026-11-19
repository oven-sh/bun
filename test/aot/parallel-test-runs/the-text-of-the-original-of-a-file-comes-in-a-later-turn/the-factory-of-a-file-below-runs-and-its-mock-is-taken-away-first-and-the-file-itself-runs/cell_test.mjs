import { afterEach, test, vi } from "bun:test";

// The factory of the file below still runs where the tests of the file are done, and the program has taken its mock away: the load in flight comes to the file below behind that, and gets the file.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
    return new Promise(() => {});
  });
  import("./below.mjs").then(it => console.log("the file below came:", it.depth));
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
  vi.doUnmock("./below.mjs");
});
