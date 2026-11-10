import { test, vi, mock } from "bun:test";
const ask = async (at, path, read) => { try { console.log("SAID", at, read(await import(path))); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const user = m => m.viaUser(), dep = m => m.who + " " + m.other;
test("t", async () => {
  await ask("first", "./user.js", user);
  vi.doMock("./dep.js", async importOriginal => ({ ...(await importOriginal()), who: "later" }));
  await ask("again", "./user.js", user);
  await ask("dep", "./dep.js", dep);
  await ask("once more", "./user.js", user);
});
