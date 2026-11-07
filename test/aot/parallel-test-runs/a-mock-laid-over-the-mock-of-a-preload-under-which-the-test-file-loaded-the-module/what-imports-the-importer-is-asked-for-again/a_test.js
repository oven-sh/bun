import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => { try { console.log("SAID", at, (await import("./dep.js")).who); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
test("t", async () => {
  await ask("first", "./above.js", "viaAbove");
  vi.doMock("./dep.js", () => ({ who: "later" }));
  await ask("again", "./above.js", "viaAbove");
  await ask("a fresh importer", "./fresh.js", "viaFresh");
  await ask("once more", "./above.js", "viaAbove");
});
