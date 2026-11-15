import { afterEach, test, vi } from "bun:test";

// `bun test` undoes every mock of a test file first and lets the loads in flight end. The body of the file comes to the mocked file by a call, which no statement shows: its factory is not called either.
test("the call is left in flight", () => {
  vi.doMock("./below.mjs", () => {
    console.log("the factory of the file below is called");
    return { depth: "mocked" };
  });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(
    () => {},
    error => console.log("the call failed:", error.message),
  );
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
