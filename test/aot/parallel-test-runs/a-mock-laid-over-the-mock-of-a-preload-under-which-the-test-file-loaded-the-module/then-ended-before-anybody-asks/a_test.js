import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => { try { console.log("SAID", at, (await import("./dep.js")).who); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
test("t", async () => {
  await ask("first", "./user.js", "viaUser");
  vi.doMock("./dep.js", () => ({ who: "later" }));
  vi.doUnmock("./dep.js");
  await ask("behind the end", "./user.js", "viaUser");
  await dep("dep behind the end");
});
