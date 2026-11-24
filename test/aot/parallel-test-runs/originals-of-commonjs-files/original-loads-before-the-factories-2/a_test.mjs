import { test, vi } from "bun:test";
const log = (globalThis.log ??= []);
test("the jar runs once and the factory gets that run", async () => {
  vi.doMock("./lid.mjs", async original => { log.push("l<"); const all = await original(); log.push("l>"); return { ...all, word: "mock lid" }; });
  vi.doMock("./jar.cjs", async original => {
    log.push("j<");
    const all = await original();
    log.push("j>");
    globalThis.given = all.box;
    return { ...all, word: "mock jar" };
  });
  const shelf = await import("./shelf.mjs");
  console.log("SAID", shelf.all, globalThis.boxes.length, globalThis.boxes.indexOf(globalThis.given));
  console.log("SAID deeps", globalThis.deeps ?? 0);
  console.log("SAID order", log.join(" "));
});
