import { test, vi, mock } from "bun:test";
const R = c => { globalThis.runs = (globalThis.runs ?? "") + c + " "; };
const tried = async p => { try { const v = await p; return typeof v === "object" && v ? Object.keys(v).sort().map(k => k + "=" + String(v[k])).join(",") : String(v); } catch (e) { return "threw " + String(e?.message).slice(0, 30); } };
const asked = f => { try { return Object.keys(f()).join(); } catch (e) { return "threw " + String(e?.message).slice(0, 30); } };
const needs = (file, tag) => vi.doMock(file, async orig => { R(tag + "<"); const o = await orig(); R(tag + "-"); return { ...o, x: "mock " + tag }; });
test("x", async () => {
  needs("./part.mjs", "f");
  const first = await tried(import("./a.mjs"));
  const second = await tried(import("./a.mjs"));
  needs("./part.mjs", "g");
  const got = first + " & " + second + " & " + await tried(import("./a.mjs")) + " & " + asked(() => require("./b.mjs"));
  console.log("SAID", got, "|", globalThis.runs);
});
