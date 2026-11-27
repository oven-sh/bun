import { afterEach, test, vi } from "bun:test";

// Two calls for one file are in flight where its mock is taken away. There is one entry under the key of the file and one load: both calls get it, in the order in which they were made.
test("two calls are left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: true }));
  setInterval(() => {}, 1000);
  import("./part.mjs").then(it => console.log("the first call came:", it.opening, it.mocked));
  import("./part.mjs").then(it => console.log("the second call came:", it.opening, it.mocked));
  console.log("the test ends");
});
afterEach(() => {
  vi.doUnmock("./part.mjs");
});
