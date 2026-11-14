import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("b", async () => {
  await all("b");
  vi.doMock("./leaf.ts", () => ({ word: "bm", N: { deep: "nbm" }, default: class { static w = "bm"; } }));
  await all("bm");
  vi.doMock("./leaf.ts", () => ({ word: "bn", N: { deep: "nbn" }, default: class { static w = "bn"; } }));
  await all("bn");
});
