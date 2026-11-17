import { test, vi, mock } from "bun:test";
test("x", async () => {
  const R = c => { globalThis.runs = (globalThis.runs ?? "") + c + " "; };
  const tried = async p => { try { const v = await p; return typeof v === "object" && v ? Object.keys(v).sort().map(k => k + "=" + String(v[k])).join(",") : String(v); } catch (e) { return "threw " + String(e?.message).slice(0, 30); } };
  let open; globalThis.gate = new Promise(r => { open = r; }); globalThis.open = open;
  const began = new Promise(r => { globalThis.began = r; });
  const needs = (file, tag) => vi.doMock(file, async orig => { R(tag + "<"); const o = await orig(); R(tag + "-"); return { ...o, x: "mock " + tag }; });
  needs("./part.mjs", "f");
  const l = tried(import("./a.mjs")); await began;
  const actual = tried(vi.importActual("./part.mjs")); R("asked"); open();
  const got = (await actual) + " & " + (await l);
  console.log("SAID", "x", got, "|", globalThis.runs);
});
