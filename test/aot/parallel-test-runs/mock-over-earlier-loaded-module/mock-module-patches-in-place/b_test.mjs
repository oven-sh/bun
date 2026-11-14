import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
test("b", async () => {
  await import("./gauge.mjs");
  delete ask.cache[ask.resolve("./gauge.mjs")];
  console.log("SAID own", (await import("./gauge.mjs")).read(), globalThis.turns);
  mock.module("./spring.mjs", () => ({ pull: "mock" }));
  const under = (await import("./gauge.mjs")).read();
  const kept = (await import("./gauge.mjs")).kept;
  
  const behind = (await import("./gauge.mjs")).read();
  console.log("SAID B", under, kept, behind, globalThis.turns);
});
