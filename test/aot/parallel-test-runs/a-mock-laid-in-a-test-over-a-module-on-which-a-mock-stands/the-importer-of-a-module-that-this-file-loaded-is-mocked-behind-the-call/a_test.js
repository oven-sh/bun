import { test, vi, mock } from "bun:test";
const ask = async (at, path, read) => { try { console.log("SAID", at, read(await import(path))); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const user = m => m.viaUser(), dep = m => m.who + " " + m.other;
test("t", async () => {
  const held = await import("./user.js");
  console.log("SAID first", held.viaUser());
  vi.doMock("./dep.js", () => ({ who: "later" }));
  mock.module("./user.js", () => ({ viaUser: () => "a mocked user" }));
  console.log("SAID held", held.viaUser());
  await ask("again", "./user.js", user);
});
