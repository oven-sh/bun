import { vi, mock, jest, test } from "bun:test";
const val = v => typeof v === "function" ? "fn" : String(v), say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  say("load", await tried(async () => (await import("./dep.cjs")).flag));
  vi.doMock("./dep.cjs", { spy: true });
  say("use", await tried(async () => { const m = await import("./dep.cjs"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  say("use", await tried(async () => { const m = await import("./dep.cjs"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  vi.doUnmock("./dep.cjs");
  say("use", await tried(async () => { const m = await import("./dep.cjs"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
});
