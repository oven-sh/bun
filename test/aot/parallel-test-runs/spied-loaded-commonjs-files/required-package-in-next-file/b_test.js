import { vi, mock, jest, test } from "bun:test";
const val = v => typeof v === "function" ? "fn" : String(v), say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("b", async () => {
  vi.doMock("@made-up/pack", { spy: true });
  say("use", await tried(() => { const m = import.meta.require("@made-up/pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  say("use", await tried(() => { const m = import.meta.require("@made-up/pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
  vi.doUnmock("@made-up/pack");
  say("use", await tried(() => { const m = import.meta.require("@made-up/pack"); return [val(m.flag), val(m.fn?.()), val(m.plain)].join("/"); }));
});
