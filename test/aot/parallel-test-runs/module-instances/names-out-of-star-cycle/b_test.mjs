import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("b", async () => {
  await all("b");
  vi.doMock("./leaf.mjs", () => ({ word: "bm", more: 2 }));
  await all("bm");
  vi.doMock("./leaf.mjs", () => ({ word: "bn", more: 2 }));
  await all("bn");
});
