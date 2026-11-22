import { test } from "bun:test";

// A mock of a preload is not undone where the tests of a file are done: its factory is called for a load in flight, as for any other.
test("the call is left in flight", () => {
  import("./part.mjs");
  console.log("the test ends");
});
