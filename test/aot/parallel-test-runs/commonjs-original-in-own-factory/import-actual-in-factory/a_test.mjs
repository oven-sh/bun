import { jest, mock, test, vi } from "bun:test";
const tell = async (name, deed) => { try { console.log("SAID", name, await deed()); } catch (e) { console.log("SAID", name, "threw", e.name, String(e.message).split("\n")[0]); } };
vi.mock("./tax.cjs", async () => { const actual = await vi.importActual("./tax.cjs"); const own = await import("./tax.cjs"); globalThis.own = own; console.log("SAID both", own.fee === actual.fee); return { ...own, rate: 9 }; });
test("one", async () => {
  await tell("sold", async () => (await import("./sale.mjs")).sold());
  await tell("mocked", async () => { const m = await import("./tax.cjs"); return [m.rate, m.fee(), m.fee === globalThis.own?.fee].join(); });
  await tell("actual", async () => { const a = jest.requireActual("./tax.cjs"); return [a.rate, a.fee(), ++a.box.n, a.fee === globalThis.own?.fee].join(); });
  await tell("actual", async () => { const a = await vi.importActual("./tax.cjs"); return [a.rate, a.fee(), ++a.box.n, a.fee === globalThis.own?.fee].join(); });
});
