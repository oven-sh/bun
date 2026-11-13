// Decorators and their metadata read the module that their load was linked to.
import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.ts"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("a", async () => {
  vi.doMock("./leaf.ts", () => ({ Kind: class { static w = "am"; }, mark: target => { (target.marks ??= []).push("am"); } }));
  await all("am");
  vi.doMock("./leaf.ts", () => ({ Kind: class { static w = "an"; }, mark: target => { (target.marks ??= []).push("an"); } }));
  await all("an");
});
