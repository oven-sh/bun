import { test, vi } from "bun:test";
const R = c => { globalThis.runs = (globalThis.runs ?? "") + c + " "; };
const tried = async p => { try { const v = await p; return Object.keys(v).sort().map(k => k + "=" + String(v[k])).join(","); } catch (e) { return "threw " + String(e?.message).slice(0, 30); } };
const needs = (file, tag) => vi.doMock(file, async orig => { R(tag + "<"); const o = await orig(); R(tag + "-"); return { ...o, x: "mock " + tag }; });
test("x", async () => {
  needs("./part.mjs", "f");
  console.log("SAID first", await tried(import("./a.mjs")));
  console.log("SAID second", await tried(import("./a.mjs")));
  vi.doUnmock("./part.mjs");
  needs("./part.mjs", "g");
  console.log("SAID third", await tried(import("./a.mjs")));
  console.log("SAID runs", globalThis.runs);
});
