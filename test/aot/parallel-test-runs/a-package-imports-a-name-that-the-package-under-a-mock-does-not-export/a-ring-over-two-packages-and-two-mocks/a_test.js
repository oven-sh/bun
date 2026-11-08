import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("loom/weft.mjs", () => ({ two: 20 }));
  vi.doMock("reed/dent.mjs", async original => ({ ...(await original()), dent: 60 }));
  await import("loom/weft.mjs");
  await import("reed/dent.mjs");
  let word;
  try { word = (await import("./whole.mjs")).look(); } catch (error) { word = error.name; }
  console.log(word);
});
