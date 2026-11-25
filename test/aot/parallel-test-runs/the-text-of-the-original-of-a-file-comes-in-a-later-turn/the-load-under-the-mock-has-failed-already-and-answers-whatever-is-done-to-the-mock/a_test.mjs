import { test, vi } from "bun:test";

// No load begins at this call: the one that the preload made under the mock has failed, and answers.
test("the mock is taken away at once", async () => {
  const load = import("./part.mjs").then(() => "came", error => error.constructor.name);
  vi.doUnmock("./part.mjs");
  console.log("the call:", await load);
});
