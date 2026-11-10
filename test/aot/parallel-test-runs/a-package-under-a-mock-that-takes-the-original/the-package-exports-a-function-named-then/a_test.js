import { test, vi } from "bun:test";
test("nobody asks the package for then", async () => {
  vi.doMock("crate", async original => ({ label: "mock label" }));
  const shelf = await import("./shelf.mjs");
  for (let job = 0; job < 30; job++) await 0;
  console.log("SAID", shelf.shown, "| calls of then", globalThis.callsOfThen ?? 0);
});
