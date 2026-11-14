import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
test("b", async () => {
  (await import("./gauge.mjs"));
  delete ask.cache[ask.resolve("./gauge.mjs")];
  console.log("SAID own", (await import("./gauge.mjs")).read(), globalThis.turns);
  vi.doMock("./spring.mjs", () => ({ pull: "mock" }));
  console.log("SAID B under", (await import("./gauge.mjs")).read(), (await import("./gauge.mjs")).kept, globalThis.turns);
  vi.doUnmock("./spring.mjs");
  console.log("SAID B behind", (await import("./gauge.mjs")).read(), globalThis.turns);
});
