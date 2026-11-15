import { test, vi } from "bun:test";
const log = [];
test("which factory is called", async () => {
  vi.doMock("./part.mjs", () => { log.push("the first"); return { a: "one" }; });
  const loaded = import("./part.mjs");
  vi.doMock("./part.mjs", () => { log.push("the second"); return { a: "two" }; });
  console.log("SAID", (await loaded).a, log.join());
});
