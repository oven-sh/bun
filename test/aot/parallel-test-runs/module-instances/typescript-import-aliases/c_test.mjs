import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("c", async () => {
  await all("c");
  vi.doMock("./leaf.ts", () => ({ word: "cm", N: { deep: "ncm" }, default: class { static w = "cm"; } }));
  await all("cm");
  vi.doMock("./leaf.ts", () => ({ word: "cn", N: { deep: "ncn" }, default: class { static w = "cn"; } }));
  await all("cn");
});
