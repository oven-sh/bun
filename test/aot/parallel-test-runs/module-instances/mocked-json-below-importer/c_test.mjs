import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("c", async () => {
  await all("c");
  vi.doMock("./data.json", () => ({ word: "cm", default: { word: "dcm" } }));
  await all("cm");
  vi.doMock("./data.json", () => ({ word: "cn", default: { word: "dcn" } }));
  await all("cn");
});
