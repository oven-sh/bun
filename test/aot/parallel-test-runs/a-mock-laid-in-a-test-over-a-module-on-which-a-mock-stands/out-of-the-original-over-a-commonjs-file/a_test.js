import { test, vi, mock, jest } from "bun:test";
const read = (held, name) => { try { return String(held[name]); } catch { return "threw"; } };
const say = (at, what) => console.log("SAID", at, read(what, "who"), read(what, "other"), Object.keys(what).sort().join("+"));
const tried = async (at, ask) => { try { say(at, await ask()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 50)); } };
test("t", async () => {
  vi.doMock("./dep.cjs", async importOriginal => ({ ...(await importOriginal()), who: "later" }));
  console.log("SAID the call has returned");
  await tried("asked", () => import("./dep.cjs"));
  await tried("by a statement", async () => ({ who: (await import("./user.js")).viaUser() }));
  await tried("required", async () => require("./dep.cjs"));
});
