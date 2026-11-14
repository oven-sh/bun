// Every form of function reads an import from the module that its load was linked to.
import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("a", async () => {
  vi.doMock("./leaf.mjs", () => ({ word: "am", default: class { static w = "am"; } }));
  await all("am");
  vi.doMock("./leaf.mjs", () => ({ word: "an", default: class { static w = "an"; } }));
  await all("an");
});
