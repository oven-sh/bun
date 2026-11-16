// Code of an earlier load keeps the mock of a built-in module that it saw.
import { test, vi, mock, jest } from "bun:test";
const show = (label, ns) => { let said; try { said = ns.view(); } catch (error) { said = error.name; } console.log(label, said, globalThis.runs); };
const kept = globalThis.kept ??= [];
const all = async label => { let ns; try { ns = await import("./view.mjs"); } catch (error) { console.log(label, "threw", error.name); } if (ns) kept.push(ns); kept.forEach((it, at) => show(label + at, it)); };
test("a", async () => {
  vi.doMock("node:path", () => ({ sep: "am", default: { sep: "dam" } }));
  await all("am");
  vi.doMock("node:path", () => ({ sep: "an", default: { sep: "dan" } }));
  await all("an");
});
