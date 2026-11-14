import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.ts"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("b", async () => {
  await all("b");
  vi.doMock("./leaf.ts", () => ({ Kind: class { static w = "bm"; }, mark: target => { (target.marks ??= []).push("bm"); } }));
  await all("bm");
  vi.doMock("./leaf.ts", () => ({ Kind: class { static w = "bn"; }, mark: target => { (target.marks ??= []).push("bn"); } }));
  await all("bn");
});
