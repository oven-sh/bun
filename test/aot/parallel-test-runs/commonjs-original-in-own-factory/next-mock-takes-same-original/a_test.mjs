import { jest, mock, test, vi } from "bun:test";
const tell = async (name, deed) => { try { console.log("SAID", name, await deed()); } catch (e) { console.log("SAID", name, "threw", e.name, String(e.message).split("\n")[0]); } };
test("one", async () => {
  vi.doMock("./tax.cjs", async () => { const own = await import("./tax.cjs"); globalThis.own = own; return { ...own, rate: 9 }; });
  await tell("sold", async () => (await import("./sale.mjs")).sold());
  await tell("mocked", async () => { const m = await import("./tax.cjs"); return [m.rate, m.fee(), m.fee === globalThis.own?.fee].join(); });
  vi.doMock("./tax.cjs", async o => { const a = await o(); return { ...a, rate: a.rate + 100, same: a.fee === globalThis.own?.fee }; });
  await tell("again", async () => { const m = await import("./tax.cjs"); return [m.rate, m.fee(), m.same].join(); });
});
