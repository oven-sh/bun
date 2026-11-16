import { jest, test, vi } from "bun:test";
const val = v => typeof v === "function" ? "fn" : String(v), say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("b", async () => {
  vi.doMock("pack", () => ({ ...jest.requireActual("pack"), plain: "mock" }));
  say("use", await tried(async () => { const m = await import("pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  say("use", await tried(async () => { const m = await import("pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  vi.doUnmock("pack");
  say("use", await tried(async () => { const m = await import("pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
});
