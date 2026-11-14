import { afterEach, test, vi } from "bun:test";

afterEach(() => {
  vi.doUnmock("./part.mjs");
});

// Nobody awaits the call. The run waits for its load all the same: the body of the file runs, and the call comes.
test("the call is left in flight", () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), added: 1 }));
  import("./part.mjs").then(all => console.log("the call came:", Object.keys(all).join()));
  console.log("the test ends");
});
