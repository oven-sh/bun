import { mock, test } from "bun:test";
test("t", async () => {
  console.log("SAID", (await import("./part.mjs")).x);
  mock.module("./part.mjs", () => ({ x: "mock" }));
  console.log("SAID", (await import("./part.mjs")).x);
  for (const key of Object.keys(require.cache)) if (key.endsWith("part.mjs")) delete require.cache[key];
  console.log("SAID", (await import("./part.mjs")).x);
});
