import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 20 }));
  let said;
  try { const all = await import("./wide.mjs"); said = all[process.argv.length > 99 ? "none" : "round"]; } catch (error) { said = error.name; }
  console.log("SAID", said);
});
