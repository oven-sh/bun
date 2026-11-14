import { test, vi } from "bun:test";
const R = c => { globalThis.runs = (globalThis.runs ?? "") + c + " "; };
const tried = async p => { try { return await p; } catch (e) { return { seen: "threw " + String(e?.message).slice(0, 30), peek: () => "none" }; } };
test("x", async () => {
  vi.doMock("./part.mjs", async orig => { R("f<"); const o = await orig(); R("f-"); return { ...o, x: "mock f" }; });
  const first = await tried(import("./a.mjs"));
  const m = await import("./part.mjs");
  console.log("SAID", "x", first.seen, m.peek(), "|", globalThis.runs);
});
