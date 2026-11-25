import { test, vi } from "bun:test";
const ask = async (at, path, name) => { try { console.log("SAID", at, (await import(path))[name]()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 40)); } };
const dep = async at => console.log("SAID", at, (await import("widget")).who);
test("a", async () => {
  await ask("a", "./user.js", "viaUser");
});
