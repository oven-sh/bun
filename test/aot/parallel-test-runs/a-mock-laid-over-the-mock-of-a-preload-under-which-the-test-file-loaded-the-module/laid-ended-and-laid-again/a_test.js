import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => { try { console.log("SAID", at, (await import("./dep.js")).who); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
test("t", async () => {
  await ask("user", "./user.js", "viaUser");
  vi.doMock("./dep.js", () => ({ who: "later" }));
  await dep("dep");
  vi.doUnmock("./dep.js");
  await dep("dep");
  vi.doMock("./dep.js", () => ({ who: "again" }));
  await ask("user", "./user.js", "viaUser");
  await dep("dep");
  await ask("user", "./user.js", "viaUser");
  vi.doUnmock("./dep.js");
  await dep("dep");
  await ask("user", "./user.js", "viaUser");
});
