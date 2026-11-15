import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
void vi;
void mock;
test("b", async () => {
  await import("./gauge.mjs");
  delete ask.cache[ask.resolve("./gauge.mjs")];
  console.log("SAID own", (await import("./gauge.mjs")).read(), globalThis.turns);
  vi.doMock("./data.json", () => ({ default: { pull: "mock" } }));
  const under = await import("./gauge.mjs");
  console.log("SAID under", under.read(), under.kept, globalThis.turns);
});
