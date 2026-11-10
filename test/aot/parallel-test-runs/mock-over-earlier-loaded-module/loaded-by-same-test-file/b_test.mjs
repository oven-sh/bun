import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
test("b", async () => {
  globalThis.turns = 0;
  await import("./gauge.mjs");
  delete ask.cache[ask.resolve("./gauge.mjs")];
  console.log("SAID own", (await import("./gauge.mjs")).read());
  console.log("SAID turns", globalThis.turns);
  vi.doMock("./spring.mjs", () => ({ pull: "mock" }));
  const under = await import("./gauge.mjs");
  console.log("SAID under", under.read());
  console.log("SAID kept", under.kept);
  console.log("SAID turns", globalThis.turns);
});
