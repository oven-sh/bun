import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => { try { console.log("SAID", at, (await import("./dep.js")).who); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
test("t", async () => {
  await ask("first", "./user.js", "viaUser");
  vi.doMock("./dep.js", () => ({ who: "later" }));
  const fresh = await import("./fresh.js");
  console.log("SAID fresh", fresh.viaFresh());
  vi.doUnmock("./dep.js");
  console.log("SAID fresh behind the end", fresh.viaFresh());
  await ask("fresh asked again", "./fresh.js", "viaFresh");
  await ask("user", "./user.js", "viaUser");
});
