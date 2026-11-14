import { test, vi, mock, jest } from "bun:test";
const read = (held, name) => { try { return String(held[name]); } catch { return "threw"; } };
const say = (at, what) => console.log("SAID", at, read(what, "who"), read(what, "other"), Object.keys(what).sort().join("+"));
const tried = async (at, ask) => { try { say(at, await ask()); } catch (e) { console.log("SAID", at, "threw", String(e.message).slice(0, 50)); } };
test("t", async () => {
  const before = (await import("./user.js")).viaUser;
  vi.doMock("./dep.js", async importOriginal => ({ ...(await importOriginal()), who: "later" }));
  const behind = (await import("./user2.js")).viaUser;
  console.log("SAID", before(), behind());
});
