import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./b1.mjs", async original => ({ ...(await original()), n1: "mock of b1.mjs:n1" }));
  try { console.log("SAID n1", String((await import("./named-n1.mjs")).look())); } catch (e) { console.log("SAID n1", e.name); }
});
