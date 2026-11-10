import { test, vi } from "bun:test";
test("the jar runs once and the factory gets that run", async () => {
  vi.doMock("./lid.mjs", async original => ({ ...(await original()), word: "mock lid" }));
  vi.doMock("./jar.cjs", async original => {
    const all = await original();
    globalThis.given = all.box;
    return { ...all, word: "mock jar" };
  });
  const shelf = await import("./shelf.mjs");
  console.log("SAID", shelf.all, globalThis.boxes.length, globalThis.boxes.indexOf(globalThis.given));
});
