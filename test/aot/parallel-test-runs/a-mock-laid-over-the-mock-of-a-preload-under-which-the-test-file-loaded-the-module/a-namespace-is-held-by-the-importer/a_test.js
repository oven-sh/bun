import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => { try { console.log("SAID", at, (await import("./dep.js")).who); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
test("t", async () => {
  await ask("first", "./space.js", "viaSpace");
  vi.doMock("./dep.js", () => ({ who: "later" }));
  await ask("again", "./space.js", "viaSpace");
  await dep("dep");
  await ask("once more", "./space.js", "viaSpace");
});
