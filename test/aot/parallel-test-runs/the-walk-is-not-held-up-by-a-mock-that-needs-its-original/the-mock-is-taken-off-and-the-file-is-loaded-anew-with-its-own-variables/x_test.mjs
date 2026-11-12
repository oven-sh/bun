import { test, vi, mock } from "bun:test";
test("x", async () => {
  const R = c => { globalThis.runs = (globalThis.runs ?? "") + c + " "; };
  const tried = async p => { try { const v = await p; return typeof v === "object" && v ? Object.keys(v).sort().map(k => k + "=" + String(v[k])).join(",") : String(v); } catch (e) { return "threw " + String(e?.message).slice(0, 30); } };
  const needs = (file, tag) => vi.doMock(file, async orig => { R(tag + "<"); const o = await orig(); globalThis.o = o; R(tag + "-"); return { ...o, x: "mock " + tag }; });
  needs("./part.mjs", "f");
  const first = await tried(import("./a.mjs"));
  const m = await import("./part.mjs");
  m.bump(); m.bump();
  vi.doUnmock("./part.mjs");
  const real = await import("./part.mjs");
  const got = [first, real.x, real.bump(), m.bump(), real === globalThis.o, real.bump === m.bump].join();
  console.log("SAID", "x", got, "|", globalThis.runs);
});
