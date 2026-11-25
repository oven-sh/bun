import { test, vi } from "bun:test";
const log = [];
test("whether the factory is called", async () => {
  vi.doMock("./part.mjs", () => { log.push("the factory"); return { a: "mocked" }; });
  const loaded = import("./part.mjs");
  vi.doUnmock("./part.mjs");
  console.log("SAID", (await loaded).a, log.join());
});
