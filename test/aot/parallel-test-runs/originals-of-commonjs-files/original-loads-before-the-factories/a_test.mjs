import { test, vi } from "bun:test";
const log = (globalThis.log ??= []);
test("the jar runs once and the factory gets that run", async () => {
  vi.doMock("./lid.mjs", async original => { log.push("l<"); const all = await original(); log.push("l>"); return { ...all, word: "mock lid" }; });
  vi.doMock("./jar.cjs", async original => {
    log.push("j<");
    const all = await original();
    log.push("j>");
    globalThis.given = all.box;
    return { ...all, word: "mock jar " + globalThis.ready };
  });
  const shelf = await import("./root.mjs");
  console.log("SAID", shelf.all, globalThis.boxes.length, globalThis.boxes.indexOf(globalThis.given));
  console.log("SAID order", log.join(" "));
});
