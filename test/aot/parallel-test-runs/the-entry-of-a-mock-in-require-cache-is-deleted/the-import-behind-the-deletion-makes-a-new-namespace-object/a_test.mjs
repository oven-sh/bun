import { test, vi } from "bun:test";
vi.mock("./part.mjs", () => ({ x: "mock" }));
test("t", async () => {
  const before = await import("./part.mjs");
  for (const key of Object.keys(require.cache)) if (key.endsWith("part.mjs")) delete require.cache[key];
  const after = await import("./part.mjs");
  console.log("SAID", before === after, after.x);
});
