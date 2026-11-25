import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => console.log("SAID", at, (await import("widget")).who);
test("b", async () => {
  await ask("b first", "./user2.js", "viaUser2");
  vi.doMock("widget", () => ({ who: "later" }));
  await ask("b the importer of the file before", "./user.js", "viaUser");
  await ask("b its own importer", "./user2.js", "viaUser2");
  console.log("SAID b what the preload holds", heldEarly());
  await ask("b the importer of the preload", "./early.js", "viaEarly");
  await dep("b the package");
});
