import { test, vi } from "bun:test";

// The body of the file makes a call of import() itself, behind the end of the tests, of a file whose factory never settles. The runner held the first call and not that one: it does not wait for it.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => new Promise(() => {}));
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    () => {},
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
