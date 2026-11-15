import { test, vi } from "bun:test";
test("one", async () => {
  await import("./inner.mjs");
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
